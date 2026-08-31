#!/usr/bin/env python3
"""Restricted internal network probe for Fred.

The service exposes only typed ping, TCP-connect, and read-only LLDP/SNMP
collection. It never invokes a shell and accepts requests only from the
configured App-Server2 address.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hmac
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


LISTEN_IP = os.environ.get("NOC_PROBE_LISTEN_IP", "10.0.0.22")
LISTEN_PORT = int(os.environ.get("NOC_PROBE_PORT", "9123"))
ALLOWED_CLIENT = os.environ.get("NOC_PROBE_ALLOWED_CLIENT", "10.0.0.44")
TOKEN = os.environ["NOC_PROBE_TOKEN"]
HOST_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,253}[A-Za-z0-9])?$")
SNMP_CONFIG_ROOT = os.environ.get("NOC_PROBE_SNMP_CONFIG_ROOT", "/etc/sccc-noc-probe-snmp")
SNMP_DEFAULT_PROFILE = os.environ.get("NOC_PROBE_SNMP_DEFAULT_PROFILE", "profile-a")
SNMP_TIMEOUT = max(1, min(10, int(os.environ.get("NOC_PROBE_SNMP_TIMEOUT", "3"))))
SNMP_RETRIES = max(0, min(3, int(os.environ.get("NOC_PROBE_SNMP_RETRIES", "1"))))
SNMP_WORKERS = max(1, min(16, int(os.environ.get("NOC_PROBE_SNMP_WORKERS", "8"))))
SNMP_OID_WORKERS = max(1, min(4, int(os.environ.get("NOC_PROBE_SNMP_OID_WORKERS", "4"))))
SNMP_COMMAND_TIMEOUT = max(15, min(120, int(os.environ.get("NOC_PROBE_SNMP_COMMAND_TIMEOUT", "45"))))
SNMP_MAX_TARGETS = max(1, min(512, int(os.environ.get("NOC_PROBE_SNMP_MAX_TARGETS", "256"))))
SNMP_ALLOWED_NETWORKS = tuple(
    ipaddress.ip_network(value.strip())
    for value in os.environ.get(
        "NOC_PROBE_SNMP_ALLOW_CIDRS",
        "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
    ).split(",")
    if value.strip()
)

LLDP_REMOTE_OID = ".1.0.8802.1.1.2.1.4.1.1"
LLDP_LOCAL_PORT_OID = ".1.0.8802.1.1.2.1.3.7.1"
IF_NAME_OID = ".1.3.6.1.2.1.31.1.1.1.1"
IF_TABLE_ENTRY_OID = ".1.3.6.1.2.1.2.2.1"
IFX_TABLE_ENTRY_OID = ".1.3.6.1.2.1.31.1.1.1"
BRIDGE_PORT_IFINDEX_OID = ".1.3.6.1.2.1.17.1.4.1.2"
QBRIDGE_PVID_OID = ".1.3.6.1.2.1.17.7.1.4.5.1.1"
QBRIDGE_VLAN_CURRENT_ENTRY_OID = ".1.3.6.1.2.1.17.7.1.4.2.1"
LAG_ATTACHED_AGG_OID = ".1.2.840.10006.300.43.1.2.1.1.13"


def load_snmp_profiles() -> dict[str, str]:
    """Load the target-to-profile map without bringing SNMP secrets into this process."""
    try:
        with open(os.path.join(SNMP_CONFIG_ROOT, "profiles.json"), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError, TypeError):
        return {}
    targets = data.get("targets") if isinstance(data, dict) else None
    if not isinstance(targets, dict):
        return {}
    profiles: dict[str, str] = {}
    for target, profile in targets.items():
        target_text = str(target).strip()
        profile_text = str(profile).strip()
        if valid_snmp_target(target_text) and re.fullmatch(r"profile-[a-z0-9-]+", profile_text):
            profile_dir = os.path.realpath(os.path.join(SNMP_CONFIG_ROOT, profile_text))
            config_root = os.path.realpath(SNMP_CONFIG_ROOT)
            if profile_dir.startswith(config_root + os.sep) and os.path.isfile(os.path.join(profile_dir, "snmp.conf")):
                profiles[target_text] = profile_dir
    return profiles


def valid_target(target: str) -> bool:
    if not target or len(target) > 255 or not HOST_RE.fullmatch(target):
        return False
    try:
        address = ipaddress.ip_address(target)
        return not (address.is_loopback or address.is_link_local or address.is_unspecified)
    except ValueError:
        return True


def valid_snmp_target(target: str) -> bool:
    """LLDP collection is IP-only and restricted to configured campus CIDRs."""
    try:
        address = ipaddress.ip_address(target)
    except ValueError:
        return False
    return not (
        address.is_loopback
        or address.is_link_local
        or address.is_unspecified
        or not any(address in network for network in SNMP_ALLOWED_NETWORKS)
    )


SNMP_PROFILES = load_snmp_profiles()


def snmp_profile_dir(target: str) -> str | None:
    assigned = SNMP_PROFILES.get(target)
    if assigned:
        return assigned
    if not re.fullmatch(r"profile-[a-z0-9-]+", SNMP_DEFAULT_PROFILE):
        return None
    candidate = os.path.realpath(os.path.join(SNMP_CONFIG_ROOT, SNMP_DEFAULT_PROFILE))
    config_root = os.path.realpath(SNMP_CONFIG_ROOT)
    if candidate.startswith(config_root + os.sep) and os.path.isfile(os.path.join(candidate, "snmp.conf")):
        return candidate
    return None


def clean_snmp_value(raw: str) -> str:
    value = raw.strip()
    if value.startswith("STRING:"):
        return value[7:].strip().strip('"')
    if value.startswith("Hex-STRING:"):
        compact = " ".join(value[11:].strip().split())
        return compact.lower().replace(" ", ":")
    if value.startswith("INTEGER:"):
        value = value[8:].strip()
        match = re.search(r"\((-?\d+)\)$", value)
        return match.group(1) if match else value
    for prefix in ("OID:", "IpAddress:", "Gauge32:", "Counter32:", "Counter64:", "Timeticks:"):
        if value.startswith(prefix):
            return value[len(prefix):].strip().strip('"')
    return value.strip('"')


def parse_walk(text: str, prefix: str) -> dict[tuple[int, ...], str]:
    values: dict[tuple[int, ...], str] = {}
    normalized_prefix = prefix if prefix.startswith(".") else "." + prefix
    for line in text.splitlines():
        if " = " not in line:
            continue
        oid, raw_value = line.split(" = ", 1)
        oid = oid.strip()
        if not oid.startswith("."):
            oid = "." + oid
        if not oid.startswith(normalized_prefix + "."):
            continue
        suffix = oid[len(normalized_prefix) + 1:]
        if not suffix or not all(part.isdigit() for part in suffix.split(".")):
            continue
        values[tuple(int(part) for part in suffix.split("."))] = clean_snmp_value(raw_value)
    return values


def safe_int(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.search(r"-?\d+", str(value))
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def status_name(value: str | None) -> str | None:
    number = safe_int(value)
    return {
        1: "up", 2: "down", 3: "testing", 4: "unknown",
        5: "dormant", 6: "notPresent", 7: "lowerLayerDown",
    }.get(number)


def bitmap_ports(value: str) -> set[int]:
    """Decode an SNMP PortList octet string into one-based bridge ports."""
    compact = re.sub(r"[^0-9a-fA-F]", "", value)
    if not compact or len(compact) % 2:
        return set()
    try:
        raw = bytes.fromhex(compact)
    except ValueError:
        return set()
    ports: set[int] = set()
    for octet_index, octet in enumerate(raw):
        for bit in range(8):
            if octet & (0x80 >> bit):
                ports.add((octet_index * 8) + bit + 1)
    return ports


def looks_physical_interface(name: str, if_type: int | None) -> bool:
    if if_type == 6:
        return True
    return bool(re.match(
        r"^(?:Eth|Ethernet|Gi|GigabitEthernet|Fa|FastEthernet|Te|TenGigabitEthernet|"
        r"Tw|TwentyFiveGigE|Fo|FortyGigabitEthernet|Hu|HundredGig|\d+/\d+/\d+)",
        name,
        re.IGNORECASE,
    ))


def run_snmpwalk(target: str, oid: str, required: bool = True) -> tuple[str, str | None]:
    profile_dir = snmp_profile_dir(target)
    if not profile_dir:
        return "", "no SNMPv3 profile is assigned to this target" if required else None
    snmp_environment = os.environ.copy()
    snmp_environment["SNMPCONFPATH"] = profile_dir
    snmp_environment["SNMP_PERSISTENT_DIR"] = "/tmp/sccc-noc-probe-snmp"
    try:
        result = subprocess.run(
            [
                "snmpwalk", "-v3", "-On",
                "-t", str(SNMP_TIMEOUT), "-r", str(SNMP_RETRIES), target, oid,
            ],
            capture_output=True,
            text=True,
            env=snmp_environment,
            timeout=SNMP_COMMAND_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return "", "SNMP walk timed out" if required else None
    except OSError as exc:
        return "", f"unable to start snmpwalk: {exc.__class__.__name__}" if required else None
    output = result.stdout or ""
    if result.returncode != 0 or not output.strip():
        detail = (result.stderr or "no SNMP response").strip().splitlines()[-1][:180]
        return "", detail if required else None
    return output, None


def collect_lldp_target(target: dict) -> dict:
    hostname = str(target.get("hostname", "")).strip()[:80]
    address = str(target.get("ip", "")).strip()
    started = time.monotonic()
    if not hostname or not HOST_RE.fullmatch(hostname) or not valid_snmp_target(address):
        return {"hostname": hostname or "unknown", "ip": address, "ok": False, "error": "invalid or disallowed target", "neighbors": []}

    oid_jobs = {
        "remote": LLDP_REMOTE_OID,
        "local": LLDP_LOCAL_PORT_OID,
        "bridgeMap": BRIDGE_PORT_IFINDEX_OID,
        "pvid": QBRIDGE_PVID_OID,
        "vlanCurrent": QBRIDGE_VLAN_CURRENT_ENTRY_OID,
        "lag": LAG_ATTACHED_AGG_OID,
    }
    # Walking the complete IF-MIB tables retrieves many unused columns and can
    # take minutes on stacked switches. Read only the columns stored by Network
    # Map so the collection finishes reliably within the command deadline.
    for column in (2, 3, 4, 5, 6, 7, 8, 10, 13, 14, 16, 19, 20):
        oid_jobs[f"ifTable.{column}"] = f"{IF_TABLE_ENTRY_OID}.{column}"
    for column in (1, 6, 10, 15, 18):
        oid_jobs[f"ifXTable.{column}"] = f"{IFX_TABLE_ENTRY_OID}.{column}"
    walk_results: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(SNMP_OID_WORKERS, len(oid_jobs))) as executor:
        jobs = {executor.submit(run_snmpwalk, address, oid, False): name for name, oid in oid_jobs.items()}
        for job in as_completed(jobs):
            output, _ = job.result()
            walk_results[jobs[job]] = output

    remote_text = walk_results.get("remote", "")
    local_text = walk_results.get("local", "")
    if_table_text = "\n".join(value for key, value in walk_results.items() if key.startswith("ifTable."))
    ifx_table_text = "\n".join(value for key, value in walk_results.items() if key.startswith("ifXTable."))
    if not remote_text.strip() and not if_table_text.strip() and not ifx_table_text.strip():
        return {
            "hostname": hostname, "ip": address, "ok": False,
            "error": "no LLDP or IF-MIB response", "neighbors": [], "interfaces": [],
            "elapsedMs": round((time.monotonic() - started) * 1000),
        }

    remote_values = parse_walk(remote_text, LLDP_REMOTE_OID)
    local_values = parse_walk(local_text, LLDP_LOCAL_PORT_OID)
    if_table = parse_walk(if_table_text, IF_TABLE_ENTRY_OID)
    ifx_table = parse_walk(ifx_table_text, IFX_TABLE_ENTRY_OID)
    if_names = {key[1:]: value for key, value in ifx_table.items() if len(key) == 2 and key[0] == 1}

    local_ids: dict[int, str] = {}
    local_descriptions: dict[int, str] = {}
    for key, value in local_values.items():
        if len(key) != 2:
            continue
        field, port_num = key
        if field == 3 and value:
            local_ids[port_num] = value
        elif field == 4 and value:
            local_descriptions[port_num] = value

    grouped: dict[tuple[int, int, int], dict[int, str]] = {}
    for key, value in remote_values.items():
        if len(key) != 4:
            continue
        field, time_mark, local_port_num, remote_index = key
        grouped.setdefault((time_mark, local_port_num, remote_index), {})[field] = value

    neighbors = []
    for (_time_mark, local_port_num, _remote_index), fields in grouped.items():
        system_name = fields.get(9, "").strip()
        chassis_id = fields.get(5, "").strip()
        remote_port = (fields.get(7) or fields.get(8) or "unknown").strip()
        local_port = (
            local_ids.get(local_port_num)
            or local_descriptions.get(local_port_num)
            or if_names.get((local_port_num,))
            or str(local_port_num)
        )
        if not system_name and not chassis_id:
            continue
        neighbors.append({
            "localPortNum": local_port_num,
            "localPort": local_port[:40],
            "remoteSystemName": system_name[:80],
            "remotePort": remote_port[:40],
            "remotePortDescription": fields.get(8, "")[:120],
            "remoteChassisId": chassis_id[:120],
            "remoteSystemDescription": fields.get(10, "")[:300],
        })

    bridge_to_ifindex = {
        key[0]: value
        for key, raw in parse_walk(walk_results.get("bridgeMap", ""), BRIDGE_PORT_IFINDEX_OID).items()
        if len(key) == 1 and (value := safe_int(raw)) is not None
    }
    pvid_by_ifindex: dict[int, int] = {}
    for key, raw in parse_walk(walk_results.get("pvid", ""), QBRIDGE_PVID_OID).items():
        if len(key) != 1:
            continue
        if_index = bridge_to_ifindex.get(key[0])
        vlan = safe_int(raw)
        if if_index is not None and vlan is not None and 1 <= vlan <= 4094:
            pvid_by_ifindex[if_index] = vlan

    allowed_by_ifindex: dict[int, set[int]] = {}
    vlan_values = parse_walk(walk_results.get("vlanCurrent", ""), QBRIDGE_VLAN_CURRENT_ENTRY_OID)
    for key, raw in vlan_values.items():
        if len(key) != 3 or key[0] != 4:
            continue
        _field, _time_mark, vlan = key
        if not 1 <= vlan <= 4094:
            continue
        for bridge_port in bitmap_ports(raw):
            if_index = bridge_to_ifindex.get(bridge_port)
            if if_index is not None:
                allowed_by_ifindex.setdefault(if_index, set()).add(vlan)

    lag_by_ifindex = {
        key[0]: aggregate
        for key, raw in parse_walk(walk_results.get("lag", ""), LAG_ATTACHED_AGG_OID).items()
        if len(key) == 1 and (aggregate := safe_int(raw)) is not None and aggregate > 0
    }
    if_indexes = sorted({key[1] for key in if_table if len(key) == 2} | {key[1] for key in ifx_table if len(key) == 2})
    interfaces = []
    for if_index in if_indexes:
        name = (ifx_table.get((1, if_index)) or if_table.get((2, if_index)) or "").strip()
        if not name:
            continue
        if_type = safe_int(if_table.get((3, if_index)))
        high_speed = safe_int(ifx_table.get((15, if_index)))
        legacy_speed = safe_int(if_table.get((5, if_index)))
        speed_mbps = high_speed if high_speed and high_speed > 0 else (legacy_speed // 1_000_000 if legacy_speed else None)
        allowed = sorted(allowed_by_ifindex.get(if_index, set()))
        native_vlan = pvid_by_ifindex.get(if_index)
        aggregate_index = lag_by_ifindex.get(if_index)
        portchannel = if_names.get((aggregate_index,)) if aggregate_index else None
        if allowed and len(allowed) > 1:
            port_mode = "trunk"
        elif native_vlan is not None and looks_physical_interface(name, if_type):
            port_mode = "access"
        elif not looks_physical_interface(name, if_type):
            port_mode = "routed"
        else:
            port_mode = "unknown"
        interfaces.append({
            "ifIndex": if_index,
            "interfaceName": name[:80],
            "isPhysical": looks_physical_interface(name, if_type),
            "description": (ifx_table.get((18, if_index)) or "")[:300],
            "ifType": if_type,
            "mtu": safe_int(if_table.get((4, if_index))),
            "macAddress": (if_table.get((6, if_index)) or "")[:32],
            "adminStatus": status_name(if_table.get((7, if_index))),
            "operStatus": status_name(if_table.get((8, if_index))),
            "speedMbps": speed_mbps,
            "nativeVlan": native_vlan,
            "allowedVlans": allowed or ([native_vlan] if native_vlan is not None else []),
            "portMode": port_mode,
            "portchannel": str(portchannel)[:40] if portchannel else None,
            "inErrors": safe_int(if_table.get((14, if_index))) or 0,
            "outErrors": safe_int(if_table.get((20, if_index))) or 0,
            "inDiscards": safe_int(if_table.get((13, if_index))) or 0,
            "outDiscards": safe_int(if_table.get((19, if_index))) or 0,
            "inOctets": str(safe_int(ifx_table.get((6, if_index))) or safe_int(if_table.get((10, if_index))) or 0),
            "outOctets": str(safe_int(ifx_table.get((10, if_index))) or safe_int(if_table.get((16, if_index))) or 0),
        })

    return {
        "hostname": hostname,
        "ip": address,
        "ok": True,
        "neighbors": neighbors,
        "interfaces": interfaces,
        "elapsedMs": round((time.monotonic() - started) * 1000),
    }


def collect_lldp(targets: list[dict]) -> dict:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    results = []
    with ThreadPoolExecutor(max_workers=min(SNMP_WORKERS, len(targets))) as executor:
        futures = {executor.submit(collect_lldp_target, target): target for target in targets}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as exc:
                target = futures[future]
                results.append({
                    "hostname": str(target.get("hostname", "unknown"))[:80],
                    "ip": str(target.get("ip", ""))[:45],
                    "ok": False,
                    "error": f"collector error: {exc.__class__.__name__}",
                    "neighbors": [],
                })
    results.sort(key=lambda item: str(item.get("hostname", "")).lower())
    return {
        "operation": "lldp_collect",
        "vantage": LISTEN_IP,
        "capturedAt": captured_at,
        "targets": len(targets),
        "successful": sum(1 for item in results if item.get("ok")),
        "failed": sum(1 for item in results if not item.get("ok")),
        "neighbors": sum(len(item.get("neighbors", [])) for item in results),
        "interfaces": sum(len(item.get("interfaces", [])) for item in results),
        "results": results,
    }


class ProbeHandler(BaseHTTPRequestHandler):
    server_version = "SCCC-NOC-Probe/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(json.dumps({"time": time.time(), "client": self.client_address[0], "message": fmt % args}), flush=True)

    def respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.client_address[0] not in {ALLOWED_CLIENT, LISTEN_IP, "127.0.0.1"}:
            self.respond(403, {"error": "client not allowed"})
        elif self.path == "/health":
            self.respond(200, {
                "status": "ok",
                "vantage": LISTEN_IP,
                "lldpCollector": bool(SNMP_PROFILES and shutil.which("snmpwalk")),
                "snmpVersion": "3",
                "configuredTargets": len(SNMP_PROFILES),
                "defaultSwitchProfile": bool(snmp_profile_dir("10.255.255.254")),
            })
        else:
            self.respond(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.client_address[0] != ALLOWED_CLIENT:
            self.respond(403, {"error": "client not allowed"})
            return
        supplied = self.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {TOKEN}"):
            self.respond(401, {"error": "unauthorized"})
            return
        if self.path not in {"/v1/probe", "/v1/lldp/collect"}:
            self.respond(404, {"error": "not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 2 or size > 65536:
                raise ValueError("invalid body size")
            data = json.loads(self.rfile.read(size))
            operation = data.get("operation")
            if self.path == "/v1/lldp/collect":
                if operation != "lldp_collect":
                    raise ValueError("operation must be lldp_collect")
                if not SNMP_PROFILES:
                    self.respond(503, {"error": "LLDP collector is not configured"})
                    return
                if not shutil.which("snmpwalk"):
                    self.respond(503, {"error": "snmpwalk is not installed"})
                    return
                targets = data.get("targets")
                if not isinstance(targets, list) or not targets or len(targets) > SNMP_MAX_TARGETS:
                    raise ValueError(f"targets must contain 1-{SNMP_MAX_TARGETS} switches")
                self.respond(200, collect_lldp(targets))
                return
            target = str(data.get("target", "")).strip()
            if not valid_target(target):
                raise ValueError("invalid target")
            if operation == "ping":
                started = time.monotonic()
                result = subprocess.run(
                    ["ping", "-c", "2", "-W", "2", target],
                    capture_output=True, text=True, timeout=6, check=False,
                )
                self.respond(200, {
                    "operation": "ping", "target": target, "reachable": result.returncode == 0,
                    "elapsedMs": round((time.monotonic() - started) * 1000),
                    "summary": (result.stdout or result.stderr)[-1500:],
                    "vantage": LISTEN_IP,
                })
                return
            if operation == "tcp":
                port = int(data.get("port", 0))
                if port < 1 or port > 65535:
                    raise ValueError("invalid port")
                started = time.monotonic()
                try:
                    with socket.create_connection((target, port), timeout=5):
                        opened, error = True, None
                except OSError as exc:
                    opened, error = False, exc.__class__.__name__
                self.respond(200, {
                    "operation": "tcp", "target": target, "port": port, "open": opened,
                    "elapsedMs": round((time.monotonic() - started) * 1000),
                    "error": error, "vantage": LISTEN_IP,
                })
                return
            raise ValueError("operation must be ping or tcp")
        except (ValueError, json.JSONDecodeError) as exc:
            self.respond(400, {"error": str(exc)})
        except subprocess.TimeoutExpired:
            self.respond(200, {"operation": "ping", "reachable": False, "error": "timeout", "vantage": LISTEN_IP})


if __name__ == "__main__":
    os.makedirs("/tmp/sccc-noc-probe-snmp", mode=0o700, exist_ok=True)
    ThreadingHTTPServer((LISTEN_IP, LISTEN_PORT), ProbeHandler).serve_forever()
