#!/usr/bin/env python3
"""Private, read-only access-port evidence. No SNMP credentials leave .22."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import importlib.util
import ipaddress
import json
import math
import multiprocessing
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import time

from pull_worker import check_private_file
from build_inventory import normalize_port

FDB_PORT = ".1.3.6.1.2.1.17.7.1.2.2.1.2"
FDB_STATUS = ".1.3.6.1.2.1.17.7.1.2.2.1.3"
BRIDGE_MAP = ".1.3.6.1.2.1.17.1.4.1.2"
IF_TABLE = ".1.3.6.1.2.1.2.2.1"
IFX_TABLE = ".1.3.6.1.2.1.31.1.1.1"
SYS_UPTIME = ".1.3.6.1.2.1.1.3"
COUNTER_DISCONTINUITY = IFX_TABLE + ".19"
MAX_SAFE = 9007199254740991
MAX_OUTPUT = 12 * 1024 * 1024
MAX_OBSERVATIONS = 60000
MAX_EDGE_MACS_PER_PORT = 8
MAX_TARGET_WORKERS = 4
NETWORK_PEER = re.compile(r"switch|router|nexus|arubaos|procurve|ios[- ]xe|cisco ios software|access point|wireless controller", re.I)
UPLINK = re.compile(r"(?:^|[\s_/-])(?:uplink|trunk|stack|port[- ]?channel|lag|to[-_ ]?sw\w*)(?:$|[\s_/-])", re.I)


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def integer(value, maximum=MAX_SAFE):
    if isinstance(value, bool):
        return None
    if isinstance(value, str) and not re.fullmatch(r"\d+", value):
        return None
    if not isinstance(value, (str, int)):
        return None
    parsed = int(value)
    return parsed if 0 <= parsed <= maximum else None


def number(value, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value if 0 <= value <= maximum else None


def ticks(value):
    match = re.match(r"^\(?(\d+)\)?(?:$|\s)", str(value))
    return integer(match.group(1), 2**32 - 1) if match else None


def load_targets(path: Path, approved_ips: set[str]) -> list[dict]:
    check_private_file(path)
    if path.stat().st_size > 128 * 1024:
        raise ValueError("Target inventory exceeds size bound")
    targets, seen = [], set()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != ["name", "ip", "building"]:
            raise ValueError("Expected sanitized name,ip,building CSV")
        for row in reader:
            name, address, building = (str(row.get(key) or "").strip() for key in ("name", "ip", "building"))
            if address not in approved_ips:
                continue
            ip = ipaddress.ip_address(address)
            if ip.version != 4 or not ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified:
                raise ValueError("Approved target must be a private campus IPv4 address")
            if address in seen or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}", name) or not building or len(building) > 120 or any(ord(c) < 32 for c in building):
                raise ValueError("Duplicate or invalid approved switch identity")
            seen.add(address)
            targets.append({"hostname": name, "ip": address, "building": building})
    if not targets or len(targets) > 1000:
        raise ValueError("No bounded approved switch inventory")
    return targets


def explicit_profiles(path: Path) -> set[str]:
    # profiles.json is target/profile metadata, not an SNMP credential file.
    # Existing root-owned 0640 metadata is valid; do not chmod the NOC contract.
    if path.is_symlink():
        raise ValueError("SNMP profile metadata must not be a symlink")
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        raise ValueError("Cannot open regular SNMP profile metadata") from None
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 128 * 1024:
            raise ValueError("SNMP profile metadata must be a bounded regular file")
        if os.name == "posix" and (info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022):
            raise ValueError("SNMP profile metadata must be root-owned and not writable by other accounts")
        raw = source.read(128 * 1024 + 1)
    if len(raw) > 128 * 1024:
        raise ValueError("SNMP profile metadata exceeds size bound")
    data = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("Invalid SNMP profile metadata object")
    targets = data.get("targets")
    if not isinstance(targets, dict) or len(targets) > 1000:
        raise ValueError("Missing explicit SNMP target map")
    return {ip for ip, profile in targets.items() if isinstance(ip, str) and isinstance(profile, str) and re.fullmatch(r"profile-[a-z0-9-]+", profile)}


def load_agent(path: Path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected the installed probe module")
    info = path.stat()
    if os.name == "posix" and (info.st_uid not in (0, os.getuid()) or stat.S_IMODE(info.st_mode) & 0o022):
        raise ValueError("Probe module must not be writable by other accounts")
    # This module requires an HTTP token at import, although local SNMP functions
    # never use it. The isolated child starts no listener or HTTP authentication.
    missing = "NOC_PROBE_TOKEN" not in os.environ
    if missing:
        os.environ["NOC_PROBE_TOKEN"] = "unused-local-import-no-listener"
    try:
        spec = importlib.util.spec_from_file_location("sccc_private_noc_probe", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        if missing:
            del os.environ["NOC_PROBE_TOKEN"]
    module.SNMP_TIMEOUT, module.SNMP_RETRIES = 1, 0
    module.SNMP_COMMAND_TIMEOUT, module.SNMP_OID_WORKERS = 15, 4
    return module


def rate(current: dict, previous: dict | None, boot_id: str, link_mbps):
    if not previous or previous.get("bootId") != boot_id or current.get("bits") != previous.get("bits"):
        return None
    for key in ("switchUptimeTicks", "discontinuityTicks"):
        if key in current or key in previous:
            if key not in current or key not in previous or (current[key] < previous[key] if key == "switchUptimeTicks" else current[key] != previous[key]):
                return None
    try:
        elapsed = current["monotonic"] - previous["monotonic"]
        delta = int(current["value"]) - int(previous["value"])
        wall = (datetime.fromisoformat(current["observedAt"]) - datetime.fromisoformat(previous["observedAt"])).total_seconds()
    except (KeyError, ValueError, TypeError):
        return None
    ceiling = number(link_mbps, 1_000_000)
    if ceiling is None or ceiling <= 0 or not 1 <= elapsed <= 600 or abs(wall - elapsed) > 30 or delta < 0:
        return None
    result = delta * 8 / elapsed
    return round(result, 3) if math.isfinite(result) and 0 <= result <= ceiling * 1_000_000 else None


def access_interfaces(snapshot: dict, names: set[str]) -> dict[int, dict]:
    excluded = set()
    short_names = {name.lower().rstrip(".").split(".")[0] for name in names}
    for neighbor in snapshot.get("neighbors", []):
        peer = str(neighbor.get("remoteSystemName", "")).lower().rstrip(".").split(".")[0]
        if peer in short_names or NETWORK_PEER.search(str(neighbor.get("remoteSystemDescription", ""))):
            excluded.add(normalize_port(neighbor.get("localPort")))
    result = {}
    for row in snapshot.get("interfaces", []):
        index, name = integer(row.get("ifIndex"), 2147483647), str(row.get("interfaceName", ""))
        if not index or row.get("isPhysical") is not True or row.get("portMode") != "access" or row.get("operStatus") != "up" or row.get("portchannel") or normalize_port(name) in excluded or UPLINK.search(str(row.get("description", ""))) or not name or len(name) > 80:
            continue
        result[index] = row
    return result


def exclude_shared_port_observations(observations: list[dict], limit=MAX_OBSERVATIONS) -> list[dict]:
    """Keep bounded, unique location evidence only for low-fan-out ports."""
    macs_by_port: dict[tuple[str, str], set[str]] = {}
    for row in observations:
        key = (row["switchName"], row["port"])
        macs_by_port.setdefault(key, set()).add(str(row["mac"]).lower())
    shared = {key for key, macs in macs_by_port.items() if len(macs) > MAX_EDGE_MACS_PER_PORT}
    filtered, seen = [], set()
    for row in observations:
        key = (row["switchName"], row["port"])
        identity = (*key, str(row["mac"]).lower())
        if key in shared or identity in seen:
            continue
        seen.add(identity)
        filtered.append(row)
        if len(filtered) >= limit:
            break
    return filtered


def bounded_process(command: list[str], environment: dict, timeout=15, max_bytes=MAX_OUTPUT) -> tuple[str, str | None]:
    """Bound SNMP output while it is produced; never expose raw stderr."""
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        try:
            process = subprocess.Popen(command, stdout=output, stderr=errors, env=environment)
        except OSError:
            return "", "SNMP bulk executable unavailable"
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                if os.fstat(output.fileno()).st_size > max_bytes or os.fstat(errors.fileno()).st_size > 65536:
                    return "", "SNMP bulk response exceeded size bound"
                if time.monotonic() >= deadline:
                    return "", "SNMP bulk table deadline exceeded"
                time.sleep(0.02)
            if os.fstat(output.fileno()).st_size > max_bytes or os.fstat(errors.fileno()).st_size > 65536:
                return "", "SNMP bulk response exceeded size bound"
            output.seek(0)
            raw = output.read(max_bytes + 1)
            if process.returncode != 0 or not raw.strip():
                return "", "SNMP bulk collection failed"
            return raw.decode("utf-8", errors="replace"), None
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=2)


def run_bulkwalk(agent, target: str, oid: str) -> tuple[str, str | None]:
    if target not in agent.SNMP_PROFILES or not agent.valid_snmp_target(target) or oid not in (FDB_PORT, FDB_STATUS):
        raise ValueError("Bulk collection is restricted to approved FDB tables")
    executable = shutil.which("snmpbulkwalk")
    if not executable:
        return "", "SNMP bulk executable unavailable"
    environment = os.environ.copy()
    environment["SNMPCONFPATH"] = agent.SNMP_PROFILES[target]
    environment["SNMP_PERSISTENT_DIR"] = "/tmp/sccc-noc-probe-snmp"
    # Credentials remain in the existing protected SNMPv3 profile. Modest bulk
    # pages avoid an unbounded GETNEXT walk and oversized UDP responses.
    return bounded_process([executable, "-v3", "-On", "-Cr25", "-t", "1", "-r", "0", target, oid], environment, timeout=15)


def collect_one(target: dict, agent, previous: dict, boot_id: str, names: set[str]) -> dict:
    if target["ip"] not in agent.SNMP_PROFILES or not agent.valid_snmp_target(target["ip"]):
        raise ValueError("Target has no explicit approved SNMP profile")
    original, captures = agent.run_snmpwalk, {}

    def observed_walk(address, oid, required=True, bulk=False):
        if address != target["ip"]:
            raise ValueError("Collector target scope changed")
        text, error = run_bulkwalk(agent, address, oid) if bulk else original(address, oid, required)
        if len(text.encode("utf-8")) > MAX_OUTPUT:
            raise ValueError("SNMP response exceeded size bound")
        captures[oid] = {"text": text, "error": bool(error), "monotonic": time.monotonic(), "observedAt": stamp()}
        return text, error

    agent.run_snmpwalk = observed_walk
    try:
        snapshot = agent.collect_lldp_target(target)
        if not snapshot.get("ok"):
            return {"ok": False, "observations": [], "ports": [], "counters": {}}
        for oid in (FDB_PORT, FDB_STATUS, BRIDGE_MAP, SYS_UPTIME, COUNTER_DISCONTINUITY):
            observed_walk(target["ip"], oid, bulk=oid in (FDB_PORT, FDB_STATUS))
    finally:
        agent.run_snmpwalk = original
    interfaces = access_interfaces(snapshot, names)
    uptime = ticks(agent.parse_walk(captures.get(SYS_UPTIME, {}).get("text", ""), SYS_UPTIME).get((0,)))
    discontinuities = agent.parse_walk(captures.get(COUNTER_DISCONTINUITY, {}).get("text", ""), COUNTER_DISCONTINUITY)
    # Retain original read times. A slow later FDB walk must not re-clock earlier
    # interface counters as if they were sampled at the end of this cycle.
    interface_times = [value["observedAt"] for oid, value in captures.items() if (oid.startswith(IF_TABLE + ".") or oid.startswith(IFX_TABLE + ".")) and value["text"]]
    telemetry_at = min(interface_times) if interface_times else stamp()
    fdb_times = [captures[oid]["observedAt"] for oid in (FDB_PORT, FDB_STATUS, BRIDGE_MAP) if oid in captures]
    observed_at, ports, counters = min(fdb_times) if fdb_times else stamp(), [], {}
    for index, interface in interfaces.items():
        telemetry = {"source": "snmp", "observedAt": telemetry_at, "ifIndex": index, "operStatus": "up"}
        speed = number(interface.get("speedMbps"), 1_000_000)
        if speed is not None:
            telemetry["linkMbps"] = speed
        for key, column in (("inErrors", 14), ("outErrors", 20), ("inDiscards", 13), ("outDiscards", 19)):
            oid = IF_TABLE + "." + str(column)
            capture = captures.get(oid, {})
            value = integer(agent.parse_walk(capture.get("text", ""), oid).get((index,)))
            if value is not None:
                telemetry[key] = value
        state = {}
        for direction, high, legacy in (("in", 6, 10), ("out", 10, 16)):
            for prefix, column, bits in ((IFX_TABLE, high, 64), (IF_TABLE, legacy, 32)):
                oid = prefix + "." + str(column)
                capture = captures.get(oid, {})
                raw = integer(agent.parse_walk(capture.get("text", ""), oid).get((index,)), 2**bits - 1)
                if raw is None:
                    continue
                sample = {"value": str(raw), "bits": bits, "monotonic": capture["monotonic"], "observedAt": capture["observedAt"], "bootId": boot_id}
                if uptime is not None:
                    sample["switchUptimeTicks"] = uptime
                discontinuity = ticks(discontinuities.get((index,)))
                if discontinuity is not None:
                    sample["discontinuityTicks"] = discontinuity
                value = rate(sample, previous.get(str(index), {}).get(direction), boot_id, speed)
                if value is not None:
                    telemetry[direction + "BitsPerSecond"] = value
                state[direction] = sample
                break
        counters[str(index)] = state
        ports.append({"switchName": target["hostname"], "port": interface["interfaceName"], "building": target["building"], "telemetry": telemetry})
    by_index = {port["telemetry"]["ifIndex"]: port for port in ports}
    bridge = {key[0]: integer(value, 2147483647) for key, value in agent.parse_walk(captures.get(BRIDGE_MAP, {}).get("text", ""), BRIDGE_MAP).items() if len(key) == 1}
    statuses = agent.parse_walk(captures.get(FDB_STATUS, {}).get("text", ""), FDB_STATUS)
    observations = []
    for key, raw_port in agent.parse_walk(captures.get(FDB_PORT, {}).get("text", ""), FDB_PORT).items():
        if len(key) != 7 or any(not 0 <= byte <= 255 for byte in key[1:]) or key[1] & 1 or not any(key[1:]) or integer(statuses.get(key)) != 3:
            continue
        port = by_index.get(bridge.get(integer(raw_port)))
        if not port:
            continue
        observations.append({"mac": ":".join(f"{byte:02x}" for byte in key[1:]), "building": target["building"], "switchName": target["hostname"], "port": port["port"], "source": "switch", "edge": True, "observedAt": observed_at, "portTelemetry": port["telemetry"]})
    fdb_ok = all(captures.get(oid, {}).get("text") and not captures[oid]["error"] and not re.search(r"No Such", captures[oid]["text"], re.I) for oid in (FDB_PORT, FDB_STATUS, BRIDGE_MAP)) and bool(bridge) and bool(snapshot.get("interfaces"))
    # A port with many learned endpoint MACs is a downstream aggregation path,
    # even when incomplete interface metadata calls it access and LLDP is silent.
    # Preserve its interface telemetry, but never use it as exact endpoint
    # location evidence. Apply this only after a complete FDB snapshot.
    observations = exclude_shared_port_observations(observations) if fdb_ok else []
    return {"ok": bool(fdb_ok), "observations": observations, "ports": ports, "counters": counters}


def _child(connection, target, agent_path, previous, boot_id, names):
    if os.name == "posix":
        os.setsid()
    try:
        connection.send(collect_one(target, load_agent(Path(agent_path)), previous, boot_id, names))
    except Exception:
        connection.send({"ok": False, "observations": [], "ports": [], "counters": {}})
    finally:
        connection.close()


def collect_targets(targets: list[dict], agent_path: Path, previous: dict, deadline_seconds=210) -> dict:
    """At most four isolated targets; abandon unfinished work before timer overlap."""
    if os.name != "posix":
        raise ValueError("Private collector runs only on the Linux NOC host")
    if not targets:
        raise ValueError("An approved target inventory is required")
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    context = multiprocessing.get_context("fork")
    start = integer(previous.get("__nextTargetIndex"), len(targets) - 1) or 0
    queue, active, results = targets[start:] + targets[:start], [], {}
    started = 0
    names = {target["hostname"].lower() for target in targets}
    deadline = time.monotonic() + min(240, max(1, deadline_seconds))
    try:
        while (queue or active) and time.monotonic() < deadline:
            while queue and len(active) < MAX_TARGET_WORKERS:
                target = queue.pop(0)
                receive, send = context.Pipe(duplex=False)
                process = context.Process(target=_child, args=(send, target, str(agent_path), previous.get(target["ip"], {}), boot_id, names))
                process.start(); send.close()
                started += 1
                active.append((process, receive, target))
            for process, receive, target in list(active):
                if receive.poll():
                    try:
                        results[target["ip"]] = receive.recv()
                    except EOFError:
                        pass
                    process.join(timeout=1); receive.close(); active.remove((process, receive, target))
                elif not process.is_alive():
                    process.join(); receive.close(); active.remove((process, receive, target))
            time.sleep(0.03)
    finally:
        for process, receive, _target in active:
            if process.is_alive():
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                process.join(timeout=2)
                if process.is_alive():
                    process.kill(); process.join(timeout=1)
            receive.close()
    counters = {**previous, "__nextTargetIndex": (start + started) % len(targets)}
    for ip, result in results.items():
        if result.get("counters"):
            counters[ip] = result["counters"]
    observations = [row for result in results.values() if result.get("ok") for row in result["observations"]][:MAX_OBSERVATIONS]
    ports = [row for result in results.values() for row in result.get("ports", [])]
    return {"observations": observations, "ports": ports, "counters": counters, "switchesObserved": sum(bool(value.get("ok")) for value in results.values()), "targetsExpected": len(targets), "degraded": len(results) != len(targets) or any(not value.get("ok") for value in results.values())}
