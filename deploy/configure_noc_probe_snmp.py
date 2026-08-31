#!/usr/bin/env python3
"""Build restricted Net-SNMP profiles from the working local Telegraf config."""

import grp
import json
import os
from pathlib import Path
import re
import tempfile


SOURCE = Path("/home/ITADMIN/sccc-ops/telegraf/telegraf.conf")
DESTINATION = Path("/etc/sccc-noc-probe-snmp")
REQUIRED = ("sec_name", "auth_password", "priv_password")


def quoted_value(block: str, key: str) -> str:
    match = re.search(rf'(?m)^\s*{re.escape(key)}\s*=\s*"((?:\\.|[^"\\])*)"', block)
    if not match:
        return ""
    return json.loads('"' + match.group(1) + '"')


def snmp_blocks(raw: str) -> list[str]:
    starts = [match.start() for match in re.finditer(r"(?m)^\[\[inputs\.snmp\]\]\s*$", raw)]
    blocks: list[str] = []
    for start in starts:
        next_header = re.search(r"(?m)^\[\[", raw[start + 1:])
        end = start + 1 + next_header.start() if next_header else len(raw)
        blocks.append(raw[start:end])
    return blocks


def config_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=True)


def main() -> None:
    raw = SOURCE.read_text(encoding="utf-8")
    profile_by_credentials: dict[tuple[str, ...], str] = {}
    profile_values: dict[str, dict[str, str]] = {}
    targets: dict[str, str] = {}

    for block in snmp_blocks(raw):
        values = {
            key: quoted_value(block, key)
            for key in (
                "sec_name", "sec_level", "auth_protocol", "auth_password",
                "priv_protocol", "priv_password",
            )
        }
        if any(not values[key] for key in REQUIRED):
            continue
        values["sec_level"] = values["sec_level"] or "authPriv"
        values["auth_protocol"] = values["auth_protocol"] or "SHA"
        values["priv_protocol"] = values["priv_protocol"] or "AES"
        credential_key = tuple(values[key] for key in (
            "sec_name", "sec_level", "auth_protocol", "auth_password",
            "priv_protocol", "priv_password",
        ))
        if credential_key not in profile_by_credentials:
            profile_name = f"profile-{chr(ord('a') + len(profile_by_credentials))}"
            profile_by_credentials[credential_key] = profile_name
            profile_values[profile_name] = values
        profile_name = profile_by_credentials[credential_key]

        agents_match = re.search(r"(?ms)^\s*agents\s*=\s*\[(.*?)\]", block)
        for agent in re.findall(r'"([^"\r\n]+)"', agents_match.group(1) if agents_match else ""):
            target = re.sub(r"^udp://", "", agent.strip(), flags=re.IGNORECASE)
            target = re.sub(r":\d+$", "", target)
            previous = targets.get(target)
            if previous and previous != profile_name:
                raise RuntimeError(f"target {target} is assigned to conflicting SNMP profiles")
            targets[target] = profile_name

    if not profile_values or not targets:
        raise RuntimeError("no usable SNMPv3 profiles were found")

    nogroup_gid = grp.getgrnam("nogroup").gr_gid
    DESTINATION.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(DESTINATION, 0, nogroup_gid)
    os.chmod(DESTINATION, 0o750)

    for profile_name, values in profile_values.items():
        profile_dir = DESTINATION / profile_name
        profile_dir.mkdir(mode=0o750, exist_ok=True)
        os.chown(profile_dir, 0, nogroup_gid)
        os.chmod(profile_dir, 0o750)
        content = "\n".join((
            "defVersion 3",
            f"defSecurityName {config_quote(values['sec_name'])}",
            f"defSecurityLevel {values['sec_level']}",
            f"defAuthType {values['auth_protocol']}",
            f"defAuthPassphrase {config_quote(values['auth_password'])}",
            f"defPrivType {values['priv_protocol']}",
            f"defPrivPassphrase {config_quote(values['priv_password'])}",
            "",
        ))
        config_path = profile_dir / "snmp.conf"
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=profile_dir, delete=False) as handle:
            handle.write(content)
            temporary = Path(handle.name)
        os.chown(temporary, 0, nogroup_gid)
        os.chmod(temporary, 0o640)
        temporary.replace(config_path)

    mapping = {"version": 1, "targets": dict(sorted(targets.items()))}
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=DESTINATION, delete=False) as handle:
        json.dump(mapping, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    os.chown(temporary, 0, nogroup_gid)
    os.chmod(temporary, 0o640)
    temporary.replace(DESTINATION / "profiles.json")
    print(f"Configured {len(profile_values)} SNMPv3 profiles for {len(targets)} targets.")


if __name__ == "__main__":
    main()
