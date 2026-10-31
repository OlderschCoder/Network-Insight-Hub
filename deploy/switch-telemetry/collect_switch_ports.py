import argparse
import json
import os
import re
import shutil
import socket
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from netmiko import ConnectHandler
from netmiko.exceptions import NetmikoAuthenticationException, NetmikoTimeoutException
from netmiko.ssh_autodetect import SSHDetect


SCHEMA = "sccc.network.switchport_telemetry.v1"
COLLECTOR = "collect_switch_ports.py"

load_dotenv(dotenv_path=os.getenv("FRED_ENV_FILE") or None)

USER1 = os.getenv("SWITCH_USER")
PASS1 = os.getenv("SWITCH_PASS")
USER2 = os.getenv("SWITCH_USER_FALLBACK", "")
PASS2 = os.getenv("SWITCH_PASS_FALLBACK", "")
SSH_TIMEOUT = int(os.getenv("SSH_TIMEOUT", "12"))
COLLECT_WORKERS = max(1, min(8, int(os.getenv("COLLECT_WORKERS", "1"))))
OUT_DIR = Path(os.getenv("OUT_DIR", "out"))
OUTPUT_JSON = Path(
    os.getenv(
        "OUTPUT_JSON",
        str(OUT_DIR / "sccc_all_switches_single.json"),
    )
)


def utc_now_iso() -> str:
    """Return a seconds-precision UTC timestamp in ISO-8601 Z notation."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def local_now_iso() -> str:
    """Return a seconds-precision local timestamp with its UTC offset."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def make_run_id(started_at: str) -> str:
    """Make the timestamp-based run identifier unique across concurrent runs."""
    return f"{started_at}_ssh_{uuid.uuid4().hex[:8]}"


def can_tcp_connect(host, port=22, timeout=3):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def session_prep(conn, platform_guess: str):
    # Prevent paging so command output is complete.
    try:
        if "aruba" in platform_guess:
            conn.send_command("no page", expect_string=r"#", read_timeout=SSH_TIMEOUT)
        else:
            conn.send_command(
                "terminal length 0", expect_string=r"#", read_timeout=SSH_TIMEOUT
            )
            conn.send_command(
                "terminal width 0", expect_string=r"#", read_timeout=SSH_TIMEOUT
            )
    except Exception:
        # Some platforms do not implement one or more terminal commands. Collection
        # can still succeed, so let the actual show commands decide the outcome.
        pass


def autodetect_device_type(ip, username, password):
    remote_device = {
        "device_type": "autodetect",
        "host": ip,
        "username": username,
        "password": password,
        "conn_timeout": SSH_TIMEOUT,
        "banner_timeout": SSH_TIMEOUT,
        "auth_timeout": SSH_TIMEOUT,
        "fast_cli": False,
    }
    guesser = SSHDetect(**remote_device)
    return guesser.autodetect()  # e.g. aruba_osswitch, cisco_nxos, cisco_ios


def refine_device_type(detected: str | None, version_output: str) -> str:
    """Correct conservative SSH autodetection using the device's version banner."""
    version = str(version_output or "").lower()
    if "arubaos-cx" in version or "aruba os-cx" in version:
        return "aruba_aoscx"
    if "aruba" in version and ("provision" in version or "procurve" in version):
        return "aruba_osswitch"
    if "nx-os" in version or "nexus operating system" in version:
        return "cisco_nxos"
    return detected or "cisco_ios"


def run_commands(conn, device_type, version_output=None):
    if device_type == "aruba_aoscx":
        commands = {
            "version": "show version",
            "system": "show system",
            "lldp": "show lldp neighbor-info detail",
            "int_status": "show interface brief",
            "int_detail": "show interface",
            "running_interfaces": "show running-config interface",
            "int_errors": "show interface statistics",
            "transceiver": "show interface transceiver",
            "multi_chassis": "show vsx status",
            "vsf": "show vsf",
            "vsf_topology": "show vsf topology",
            "mac": "show mac-address-table",
        }
    elif device_type == "aruba_osswitch":
        commands = {
            "version": "show version",
            "system": "show system",
            "lldp": "show lldp neighbors detail",
            "int_status": "show interface status",
            "int_detail": "show interfaces",
            "int_trunk": "show trunks",
            "int_errors": "show interfaces counters",
            "transceiver": "show interfaces transceiver detail",
            "mac": "show mac-address-table",
        }
    elif device_type == "cisco_nxos":
        commands = {
            "version": "show version",
            "inventory": "show inventory",
            "lldp": "show lldp neighbors detail",
            "int_status": "show interface status",
            "int_detail": "show interface",
            "int_trunk": "show interface trunk",
            "int_errors": "show interface counters errors",
            "transceiver": "show interface transceiver details",
            "multi_chassis": "show vpc",
            "mac": "show mac address-table",
        }
    else:  # cisco_ios and fallback
        commands = {
            "version": "show version",
            "inventory": "show inventory",
            "lldp": "show lldp neighbors detail",
            "int_status": "show interfaces status",
            "int_detail": "show interfaces",
            "int_trunk": "show interfaces trunk",
            "int_errors": "show interfaces counters errors",
            "transceiver": "show interfaces transceiver detail",
            "multi_chassis": "show etherchannel summary",
            "mac": "show mac address-table",
        }

    output = {}
    for key, command in commands.items():
        if key == "version" and version_output is not None:
            output[key] = version_output
            continue
        try:
            output[key] = conn.send_command(command, read_timeout=max(SSH_TIMEOUT, 30))
        except Exception as exc:
            # One unsupported/slow detail command must not discard the successful
            # status, LLDP, and MAC sections from the same switch.
            output[key] = f"Collector command failed ({command}): {exc}"
    return output


def try_connect(ip, username, password, device_type):
    return ConnectHandler(
        device_type=device_type,
        host=ip,
        username=username,
        password=password,
        conn_timeout=SSH_TIMEOUT,
        banner_timeout=SSH_TIMEOUT,
        auth_timeout=SSH_TIMEOUT,
        fast_cli=False,
    )


_INTERFACE_STATUS_RE = re.compile(
    r"^\s*(?P<port>\S+)\s+"
    r"(?P<name>.*?)\s+"
    r"(?P<status>connected|notconnect|disabled|err-?disabled|inactive|"
    r"monitoring|suspended|noOperMem|sfpAbsent|xcvrAbsent|up|down)\s+"
    r"(?P<vlan>\S+)\s+"
    r"(?P<duplex>\S+)\s+"
    r"(?P<speed>\S+)"
    r"(?:\s+(?P<type>.*?))?\s*$",
    re.IGNORECASE,
)

_PHYSICAL_INTERFACE_RE = re.compile(
    r"^(?:"
    r"\d+(?:/\d+){2,3}(?::\d+)?|"  # ArubaOS-CX: 1/1/1, 1/1/1:1
    r"\d+|"  # ArubaOS-Switch: 1, 2, ...
    r"(?:Eth(?:ernet)?|Fa(?:stEthernet)?|Gi(?:gabitEthernet)?|"
    r"Te(?:nGigabitEthernet)?|Twe(?:ntyFiveGigE)?|Fo(?:rtyGigabitEthernet)?|"
    r"Hu(?:ndredGigE)?|TwoGigabitEthernet)\d+(?:/\d+){1,3}(?::\d+)?"
    r")$",
    re.IGNORECASE,
)


def _speed_mbps(raw_speed):
    """Convert common CLI speed strings to integer Mbps when they are explicit."""
    value = str(raw_speed or "").strip().lower().replace(" ", "")
    value = re.sub(r"^a-", "", value)
    if not value or value in {"--", "auto", "unknown", "n/a"}:
        return None
    match = re.match(r"^(\d+(?:\.\d+)?)([kmgt]?)", value)
    if not match:
        return None
    number = float(match.group(1))
    unit = match.group(2)
    multiplier = {"": 1, "k": 0.001, "m": 1, "g": 1000, "t": 1_000_000}[unit]
    return int(number * multiplier)


def _interface_record(
    *,
    port,
    name="",
    status="",
    vlan=None,
    duplex="",
    speed="",
    media_type="",
    enabled=None,
    mode=None,
    reason=None,
):
    """Return the backward-compatible interface shape plus explicit telemetry fields."""
    raw_status = str(status or "").strip()
    status_lower = raw_status.lower()
    if enabled is True:
        admin_status = "up"
    elif enabled is False or status_lower in {"disabled", "err-disabled", "errdisabled"}:
        admin_status = "down"
    else:
        admin_status = "unknown"

    if status_lower in {"up", "connected"}:
        oper_status = "up"
    elif status_lower:
        oper_status = "down"
    else:
        oper_status = "unknown"

    vlan_text = None if vlan is None else str(vlan).strip()
    native_vlan = int(vlan_text) if vlan_text and vlan_text.isdigit() else None
    description = "" if str(name or "").strip() == "--" else str(name or "").strip()
    port_text = str(port or "").strip()
    media_text = "" if str(media_type or "").strip() == "--" else str(media_type or "").strip()
    return {
        # Original keys remain for backward compatibility.
        "port": port_text,
        "name": description,
        "status": status_lower,
        "vlan": vlan_text,
        "duplex": str(duplex or "").strip(),
        "speed": str(speed or "").strip(),
        "type": media_text,
        # Explicit normalized fields used by Insights.
        "description": description,
        "admin_status": admin_status,
        "oper_status": oper_status,
        "enabled": enabled,
        "mode": str(mode or "").strip().lower() or None,
        "native_vlan": native_vlan,
        "speed_mbps": _speed_mbps(speed),
        "media_type": media_text or None,
        "reason": str(reason or "").strip() or None,
        "is_physical": bool(_PHYSICAL_INTERFACE_RE.match(port_text)),
    }


def _parse_aoscx_interface_brief(raw_text: str) -> list[dict]:
    """Parse the fixed-width table returned by AOS-CX show interface brief."""
    lines = (raw_text or "").splitlines()
    required_labels = (
        "Port",
        "Native",
        "Mode",
        "Type",
        "Enabled",
        "Status",
        "Reason",
        "Speed",
    )
    for header_index, header in enumerate(lines):
        if not all(label in header for label in required_labels):
            continue

        description_label = "Description" if "Description" in header else "Desc"
        labels = [*required_labels, description_label]
        starts = [header.find(label) for label in labels]
        if any(start < 0 for start in starts) or starts != sorted(starts):
            continue

        rows = []
        for line in lines[header_index + 1 :]:
            if not line.strip() or re.match(r"^\s*-{5,}\s*$", line):
                continue
            values = {}
            for index, label in enumerate(labels):
                end = starts[index + 1] if index + 1 < len(starts) else None
                values[label] = line[starts[index] : end].strip()

            if values["Enabled"].lower() not in {"yes", "no"}:
                continue
            if values["Status"].lower() not in {"up", "down"}:
                continue
            rows.append(
                _interface_record(
                    port=values["Port"],
                    name=values[description_label],
                    status=values["Status"],
                    vlan=values["Native"],
                    speed=values["Speed"],
                    media_type=values["Type"],
                    enabled=values["Enabled"].lower() == "yes",
                    mode=values["Mode"],
                    reason=values["Reason"],
                )
            )
        if rows:
            return rows
    return []


def _parse_cisco_interface_status(raw_text: str) -> list[dict]:
    """Parse IOS/NX-OS fixed-width status tables, including truncated states."""
    lines = (raw_text or "").splitlines()
    labels = ["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"]
    starts = None
    rows = []
    for line in lines:
        if all(label in line for label in labels):
            candidate = [line.find(label) for label in labels]
            starts = candidate if candidate == sorted(candidate) and min(candidate) >= 0 else None
            continue
        if starts is None or not line.strip() or re.match(r"^\s*-{5,}\s*$", line):
            continue

        values = {}
        for index, label in enumerate(labels):
            end = starts[index + 1] if index + 1 < len(starts) else None
            values[label] = line[starts[index] : end].strip()
        port = values["Port"]
        if not port or port.lower() == "port":
            continue
        status = values["Status"]
        if not status or status.lower() == "status":
            continue
        rows.append(
            _interface_record(
                port=port,
                name=values["Name"],
                status=status,
                vlan=values["Vlan"],
                duplex=values["Duplex"],
                speed=values["Speed"],
                media_type=values["Type"],
            )
        )
    return rows


def parse_interface_status(raw_text: str) -> list[dict]:
    """Parse Cisco and ArubaOS-Switch interface status tables."""
    aoscx_interfaces = _parse_aoscx_interface_brief(raw_text)
    if aoscx_interfaces:
        return aoscx_interfaces

    cisco_interfaces = _parse_cisco_interface_status(raw_text)
    if cisco_interfaces:
        return cisco_interfaces

    interfaces = []
    for line in (raw_text or "").splitlines():
        # ArubaOS-Switch/ProCurve example:
        # 1  100/1000T | No  Yes  Up  1000FDx  Auto  off  0
        aruba_match = re.match(
            r"^\s*(?P<port>\S+)\s+(?P<type>\S+)\s+\|\s+\S+\s+"
            r"(?P<enabled>Yes|No)\s+(?P<status>Up|Down|Disabled)\s+"
            r"(?P<mode>\S+)",
            line,
            flags=re.IGNORECASE,
        )
        if aruba_match:
            values = aruba_match.groupdict()
            mode = values["mode"]
            speed_match = re.search(r"\d+(?:\.\d+)?(?:[KMG])?", mode, re.IGNORECASE)
            if "fdx" in mode.lower():
                duplex = "full"
            elif "hdx" in mode.lower():
                duplex = "half"
            else:
                duplex = "auto"
            interfaces.append(
                _interface_record(
                    port=values["port"],
                    status=values["status"],
                    duplex=duplex,
                    speed=speed_match.group(0) if speed_match else mode,
                    media_type=values["type"],
                    enabled=values["enabled"].lower() == "yes",
                )
            )
            continue

        match = _INTERFACE_STATUS_RE.match(line)
        if match:
            values = match.groupdict()
            interfaces.append(
                _interface_record(
                    port=values["port"],
                    name=values["name"],
                    status=values["status"],
                    vlan=values["vlan"],
                    duplex=values["duplex"],
                    speed=values["speed"],
                    media_type=values["type"],
                )
            )
    return interfaces


def _lldp_value(block: str, field_pattern: str):
    match = re.search(
        rf"^[ \t]*{field_pattern}[ \t]*:[ \t]*(.*?)[ \t]*$",
        block,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    if not match:
        return None
    value = match.group(1).strip()
    if not value or "not advertised" in value.lower():
        return None
    return value


def _lldp_blocks(raw_text: str) -> list[str]:
    chassis_pattern = r"(?:Neighbor[ \t]+)?Chassis[- \t]*ID"
    separated = re.split(r"(?m)^\s*-{20,}\s*$", raw_text or "")
    blocks = []
    for block in separated:
        starts = list(re.finditer(rf"(?mi)^[ \t]*{chassis_pattern}[ \t]*:", block))
        if len(starts) == 1:
            blocks.append(block)
        elif len(starts) > 1:
            # NX-OS commonly separates neighbors with blank lines rather than
            # dashed rules. Each Chassis id starts a complete neighbor block.
            blocks.extend(
                block[match.start() : starts[index + 1].start() if index + 1 < len(starts) else None]
                for index, match in enumerate(starts)
            )
    if blocks:
        return blocks

    # Some platforms do not print dashed separators. Keep each repeated Chassis
    # section as an independent neighbor in that case.
    starts = list(
        re.finditer(rf"(?mi)^[ \t]*{chassis_pattern}[ \t]*:", raw_text or "")
    )
    return [
        raw_text[match.start() : starts[index + 1].start() if index + 1 < len(starts) else None]
        for index, match in enumerate(starts)
    ]


def parse_lldp_neighbors(raw_text: str) -> list[dict]:
    """Parse repeated LLDP detail blocks into normalized neighbor records."""
    neighbors = []
    for block in _lldp_blocks(raw_text):
        chassis_id = _lldp_value(block, r"(?:Neighbor[ \t]+)?Chassis[- \t]*ID")
        if not chassis_id:
            continue

        addresses = []
        for match in re.finditer(
            r"(?mi)^[ \t]*(?:IP(?:v4|v6)?(?:[ \t]+Address)?|"
            r"(?:Neighbor[ \t]+)?Management[- \t]+Address)"
            r"[ \t]*:[ \t]*(\S+)[ \t]*$",
            block,
        ):
            address = match.group(1)
            if address not in addresses:
                addresses.append(address)

        local_port = _lldp_value(
            block, r"Local[ \t]+(?:Intf|Interface|Port)(?:[ \t]+id)?"
        ) or _lldp_value(block, r"Port")
        neighbors.append(
            {
                "local_port": local_port,
                "chassis_id": chassis_id,
                "port_id": _lldp_value(
                    block, r"(?:Neighbor[ \t]+)?Port[- \t]*ID"
                ),
                "port_description": _lldp_value(
                    block, r"(?:Neighbor[ \t]+)?Port[- \t]*(?:Desc|Description)"
                ),
                "system_name": _lldp_value(
                    block,
                    r"(?:Neighbor[ \t]+)?(?:Chassis|System)[- \t]*Name",
                ),
                "management_addresses": addresses,
                "vlan_id": _lldp_value(
                    block, r"(?:Neighbor[ \t]+Port[ \t]+)?Vlan[ \t]*ID"
                ),
            }
        )
    return neighbors


_MAC_RE = re.compile(
    r"^(?:[0-9a-f]{4}\.){2}[0-9a-f]{4}$|"
    r"^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|"
    r"^[0-9a-f]{6}-[0-9a-f]{6}$",
    re.IGNORECASE,
)
_DYNAMIC_MAC_TYPES = {"dynamic", "learned", "learn"}


def _natural_key(value: str):
    return [int(piece) if piece.isdigit() else piece.lower() for piece in re.split(r"(\d+)", value)]


def parse_mac_counts(raw_text: str) -> list[dict]:
    """Count learned/dynamic MAC table entries per physical or logical port."""
    counts = Counter()
    for line in (raw_text or "").splitlines():
        tokens = line.split()
        mac_indexes = [index for index, token in enumerate(tokens) if _MAC_RE.match(token)]
        if not mac_indexes:
            continue

        mac_index = mac_indexes[0]
        type_index = next(
            (
                index
                for index in range(mac_index + 1, len(tokens))
                if tokens[index].lower() in _DYNAMIC_MAC_TYPES
            ),
            None,
        )
        if type_index is None:
            # STATIC entries are intentionally excluded.
            continue

        if type_index == len(tokens) - 1:
            # ArubaOS-Switch commonly puts Dynamic/Learned after the port.
            port = tokens[type_index - 1] if type_index > mac_index + 1 else ""
        else:
            # IOS and NX-OS put the port at the end of the row.
            port = tokens[-1]

        if not port or port.upper() == "CPU":
            continue
        counts[port] += 1

    return [
        {"port": port, "count": counts[port]}
        for port in sorted(counts, key=_natural_key)
    ]


def parse_device_identity(raw_cli: dict, device_type: str | None = None) -> dict:
    """Extract only positively identified chassis facts from version/system output."""
    version = str(raw_cli.get("version") or "")
    system = str(raw_cli.get("system") or "")
    inventory = str(raw_cli.get("inventory") or "")
    combined = "\n".join((version, system, inventory))
    platform = str(device_type or "").lower()

    if "aruba" in platform:
        vendor = "Aruba"
    elif "cisco" in platform:
        vendor = "Cisco"
    else:
        vendor = None

    hostname = None
    for pattern in (
        r"(?mi)^\s*Device name:\s*(\S+)",
        r"(?mi)^\s*Hostname\s*:\s*(\S+)",
    ):
        match = re.search(pattern, combined)
        if match:
            hostname = match.group(1).strip()
            break

    models = []
    for pattern in (
        r"(?mi)^\s*Model number\s*:\s*(\S+)",
        r"(?mi)^\s*cisco\s+Nexus\S*\s+(\S+)\s+chassis\s*$",
        r"(?mi)^\s*Product Name\s*:\s*(.+?)\s*$",
    ):
        for match in re.finditer(pattern, combined):
            value = match.group(1).strip()
            if value and value not in models:
                models.append(value)

    serial_numbers = []
    for pattern in (
        r"(?mi)^\s*(?:Processor Board ID|System serial number|Serial Number)\s*:?\s*(\S+)",
    ):
        for match in re.finditer(pattern, combined):
            value = match.group(1).strip()
            if value and value not in serial_numbers:
                serial_numbers.append(value)

    os_version = None
    for pattern in (
        r"(?mi)^\s*NXOS:\s*version\s+([^\[]+)",
        r"(?mi)^\s*Version\s*:\s*(\S+)",
        r"(?mi)Cisco IOS Software.*?Version\s+([^,\s]+)",
    ):
        match = re.search(pattern, version)
        if match:
            os_version = match.group(1).strip()
            break

    if len(models) == 1:
        model = models[0]
    elif models:
        model = " / ".join(models)
    else:
        model = None
    return {
        "hostname": hostname,
        "vendor": vendor,
        "model": model,
        "models": models,
        "serial_numbers": serial_numbers,
        "os_version": os_version,
    }


def normalize_cli(raw_cli: dict, device_type: str | None = None) -> tuple[dict, list[str]]:
    """Normalize each available CLI section without discarding its raw text."""
    normalized = {
        "interfaces": [],
        "lldp_neighbors": [],
        "mac_counts": [],
        "device": parse_device_identity(raw_cli, device_type),
    }
    warnings = []
    parsers = {
        "interfaces": ("int_status", parse_interface_status),
        "lldp_neighbors": ("lldp", parse_lldp_neighbors),
        "mac_counts": ("mac", parse_mac_counts),
    }
    for output_key, (raw_key, parser) in parsers.items():
        raw_text = raw_cli.get(raw_key)
        if not raw_text:
            continue
        cli_error = re.search(
            r"(?mi)^\s*(?:%\s*)?(Invalid input|Ambiguous command|Unknown command)",
            raw_text,
        )
        if cli_error:
            first_line = next(
                (line.strip() for line in raw_text.splitlines() if line.strip()),
                "CLI command failed",
            )
            warnings.append(f"raw_cli.{raw_key} reports a CLI error: {first_line}")
            continue
        try:
            normalized[output_key] = parser(raw_text)
        except Exception as exc:
            warnings.append(f"Could not parse raw_cli.{raw_key}: {exc}")
    return normalized, warnings


def run_one(ip, name=None, building=None):
    result = {
        "switch_name": name or "",
        "switch_ip": ip,
        "building": building or None,
        "platform": None,
        "device_type": None,
        "polled_at": local_now_iso(),
        "ok": False,
        "errors": [],
        "warnings": [],
        "device": {},
        "interfaces": [],
        "lldp_neighbors": [],
        "mac_counts": [],
        "raw_cli": {},
    }

    if not can_tcp_connect(ip, 22, timeout=3):
        result["errors"].append("TCP/22 not reachable")
        return result

    credentials = [(USER1, PASS1)]
    if USER2 and PASS2:
        credentials.append((USER2, PASS2))

    failed_users = []
    for username, password in credentials:
        conn = None
        try:
            detected = autodetect_device_type(ip, username, password) or "cisco_ios"
            result["platform"] = detected
            result["device_type"] = detected

            conn = try_connect(ip, username, password, detected)
            session_prep(conn, detected)
            version_output = conn.send_command("show version", read_timeout=max(SSH_TIMEOUT, 30))
            refined = refine_device_type(detected, version_output)
            if refined != detected:
                conn.disconnect()
                conn = try_connect(ip, username, password, refined)
                session_prep(conn, refined)
                version_output = conn.send_command(
                    "show version", read_timeout=max(SSH_TIMEOUT, 30)
                )
            result["platform"] = refined
            result["device_type"] = refined

            raw_cli = run_commands(conn, refined, version_output=version_output)
            normalized, parse_warnings = normalize_cli(raw_cli, refined)
            result["raw_cli"] = raw_cli
            result.update(normalized)
            result["warnings"].extend(
                f"{failed_user} auth failed; {username} succeeded"
                for failed_user in failed_users
            )
            result["warnings"].extend(parse_warnings)
            result["errors"] = []
            result["ok"] = True
            return result

        except NetmikoAuthenticationException:
            failed_users.append(username)
            result["errors"].append(f"Authentication failed for {username}")
        except NetmikoTimeoutException as exc:
            result["errors"].append(str(exc))
            break
        except Exception as exc:
            result["errors"].append(str(exc))
            break
        finally:
            if conn is not None:
                try:
                    conn.disconnect()
                except Exception:
                    pass

    return result


def build_output(switches: list[dict], run_id: str, generated_at: str, collection_scope: str, target_ips: list[str]) -> dict:
    switch_count_ok = sum(1 for switch in switches if switch.get("ok") is True)
    return {
        "schema": SCHEMA,
        "run_id": run_id,
        "generated_at": generated_at,
        "collection_scope": collection_scope,
        "target_ips": target_ips,
        "source": {"collector": COLLECTOR, "method": "ssh"},
        "switch_count": len(switches),
        "switch_count_ok": switch_count_ok,
        "switch_count_failed": len(switches) - switch_count_ok,
        "switches": switches,
    }


def normalize_existing_output(path: Path) -> Path:
    """Rebuild normalized sections from raw_cli without polling switches again."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != SCHEMA or not isinstance(data.get("switches"), list):
        raise SystemExit(f"{path} is not a {SCHEMA} aggregate")

    stamp = utc_now_iso().replace(":", "").replace("-", "")
    backup = path.with_name(f"{path.stem}.pre-normalize-{stamp}{path.suffix}")
    shutil.copy2(path, backup)

    building_by_target = {}
    inventory_path = Path(os.getenv("FRED_INVENTORY_FILE", "switches.csv"))
    if inventory_path.exists():
        inventory = pd.read_csv(inventory_path)
        for _, row in inventory.iterrows():
            name = str(row.get("name", "")).strip().lower()
            ip = str(row.get("ip", "")).strip()
            building = row.get("building")
            if name and ip and not pd.isna(building):
                building_by_target[(name, ip)] = str(building).strip()

    for switch in data["switches"]:
        switch["building"] = building_by_target.get(
            (str(switch.get("switch_name", "")).strip().lower(), str(switch.get("switch_ip", "")).strip()),
            switch.get("building"),
        )
        raw_cli = switch.get("raw_cli") or {}
        normalized, parse_warnings = normalize_cli(raw_cli, switch.get("device_type"))
        switch.update(normalized)
        retained = [
            warning
            for warning in switch.get("warnings", [])
            if not str(warning).startswith(("raw_cli.", "Could not parse raw_cli."))
        ]
        switch["warnings"] = [*retained, *parse_warnings]

    data["normalized_at"] = utc_now_iso()
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
    temporary.replace(path)
    return backup


def main():
    parser = argparse.ArgumentParser(description="Collect and normalize switch-port telemetry")
    parser.add_argument(
        "--normalize-existing",
        type=Path,
        metavar="JSON",
        help="rebuild interfaces/LLDP/MAC sections from raw_cli without SSH polling",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=COLLECT_WORKERS,
        help="number of switches to poll concurrently (1-8; default: COLLECT_WORKERS or 1)",
    )
    parser.add_argument(
        "--target-ip",
        action="append",
        default=[],
        help="collect only this IP (repeat for multiple switches)",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=OUTPUT_JSON,
        help="output file (use a separate file for a partial collection)",
    )
    args = parser.parse_args()

    if args.normalize_existing:
        backup = normalize_existing_output(args.normalize_existing)
        print(f"Re-normalized {args.normalize_existing.resolve()}")
        print(f"Backup: {backup.resolve()}")
        return

    if not USER1 or not PASS1:
        raise SystemExit("Missing SWITCH_USER or SWITCH_PASS in .env")

    started_at = utc_now_iso()
    run_id = make_run_id(started_at)
    inventory_path = Path(os.getenv("FRED_INVENTORY_FILE", "switches.csv"))
    df = pd.read_csv(inventory_path)
    records = [row.to_dict() for _, row in df.iterrows()]
    if args.target_ip:
        requested_ips = {str(ip).strip() for ip in args.target_ip}
        records = [row for row in records if str(row.get("ip", "")).strip() in requested_ips]
        found_ips = {str(row.get("ip", "")).strip() for row in records}
        missing_ips = sorted(requested_ips - found_ips)
        if missing_ips:
            raise SystemExit(f"Target IPs not found in {inventory_path}: {', '.join(missing_ips)}")
        if not records:
            raise SystemExit("No switches selected for collection")
    worker_count = max(1, min(8, int(args.workers)))
    all_results = [None] * len(records)
    summary_rows = [None] * len(records)

    def collect_inventory_row(index, row):
        raw_name = row.get("name", "")
        name = "" if pd.isna(raw_name) else str(raw_name).strip()
        raw_building = row.get("building", "")
        building = "" if pd.isna(raw_building) else str(raw_building).strip()
        ip = str(row["ip"]).strip()

        print(f"Collecting {name} ({ip})...")
        result = run_one(ip, name=name, building=building)
        return index, result, {
            "name": name,
            "ip": ip,
            "building": building,
            "ok": result["ok"],
            "device_type": result.get("device_type"),
            "error": "; ".join(result.get("errors", []))[:300],
            "warning": "; ".join(result.get("warnings", []))[:300],
        }

    if worker_count == 1:
        completed = (collect_inventory_row(index, row) for index, row in enumerate(records))
        for index, result, summary in completed:
            all_results[index] = result
            summary_rows[index] = summary
    else:
        print(f"Polling {len(records)} switches with {worker_count} concurrent workers...")
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(collect_inventory_row, index, row)
                for index, row in enumerate(records)
            ]
            for future in as_completed(futures):
                index, result, summary = future.result()
                all_results[index] = result
                summary_rows[index] = summary

    collection_scope = "partial" if args.target_ip else "full"
    output = build_output(
        all_results,
        run_id=run_id,
        generated_at=utc_now_iso(),
        collection_scope=collection_scope,
        target_ips=[str(row.get("ip", "")).strip() for row in records],
    )
    output_json = args.output_json
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(output, indent=2), encoding="utf-8")
    telegraf_fragment = output_json.with_suffix(".telegraf-agents.toml")
    successful_agents = [
        f'  "udp://{str(row.get("ip", "")).strip()}:161"'
        for row, result in zip(records, all_results)
        if result and result.get("ok")
    ]
    telegraf_fragment.write_text(
        "# Generated by collect_switch_ports.py\n"
        f"# Run ID: {run_id}\n"
        "# Merge this agents value into the existing [[inputs.snmp]] block on 10.0.0.22.\n"
        "# This fragment deliberately contains no SNMP credentials.\n"
        "agents = [\n"
        + ",\n".join(successful_agents)
        + "\n]\n",
        encoding="utf-8",
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(summary_rows).to_csv(OUT_DIR / "summary.csv", index=False)
    print(f"Done. JSON output: {output_json.resolve()}")
    print(f"Telegraf agents update: {telegraf_fragment.resolve()}")


if __name__ == "__main__":
    main()
