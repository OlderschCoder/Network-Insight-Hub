#!/usr/bin/env python3
"""Generate the High School MFA TAP usage report consumed by Insight Hub.

The production student self-service policy permits 15 successful TAP issuances
per student per UTC day. Activity at four or more issuances remains visible for
review, while activity above 15 is classified as exceeding policy.
"""

import collections
import datetime as dt
import json
import os
import pathlib
import subprocess
import tempfile
import urllib.parse
import urllib.request

AUDIT_PATH = pathlib.Path(os.environ.get("KIOSK_AUDIT_PATH", "/var/lib/sccc-mfa/audit.jsonl"))
OUTPUT_PATH = pathlib.Path(os.environ.get("MFA_TAP_USAGE_REPORT_PATH", "/home/scccadmin/apps/Network-Insight-Hub/data/mfa-tap-usage-report.json"))
DAILY_LIMIT = 15
REVIEW_THRESHOLD = 4
LOOKBACK_DAYS = 90


def service_environment() -> dict[str, str]:
    pid = subprocess.check_output(
        ["systemctl", "show", "--property=MainPID", "--value", "sccc-mfa.service"],
        text=True,
    ).strip()
    if not pid.isdigit() or pid == "0":
        raise RuntimeError("SCCC MFA service is not running")
    raw = pathlib.Path(f"/proc/{pid}/environ").read_bytes()
    values: dict[str, str] = {}
    for item in raw.split(b"\0"):
        if b"=" not in item:
            continue
        key, value = item.split(b"=", 1)
        values[key.decode("utf-8")] = value.decode("utf-8")
    return values


def graph_token(env: dict[str, str]) -> str:
    body = urllib.parse.urlencode({
        "client_id": env["ENTRA_CLIENT_ID"],
        "client_secret": env["ENTRA_CLIENT_SECRET"],
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode()
    request = urllib.request.Request(
        f"https://login.microsoftonline.com/{env['ENTRA_TENANT_ID']}/oauth2/v2.0/token",
        data=body,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)["access_token"]


def graph_user(token: str, object_id: str) -> dict[str, str]:
    select = urllib.parse.quote("displayName,userPrincipalName,onPremisesExtensionAttributes", safe=",")
    request = urllib.request.Request(
        f"https://graph.microsoft.com/v1.0/users/{urllib.parse.quote(object_id)}?$select={select}",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            value = json.load(response)
    except Exception:
        return {"displayName": "", "userPrincipalName": "", "studentId": ""}
    attrs = value.get("onPremisesExtensionAttributes") or {}
    return {
        "displayName": value.get("displayName") or "",
        "userPrincipalName": value.get("userPrincipalName") or "",
        "studentId": attrs.get("extensionAttribute2") or "",
    }


def main() -> None:
    env = service_environment()
    try:
        daily_limit = max(1, int(env.get("STUDENT_DAILY_LIMIT", str(DAILY_LIMIT))))
    except ValueError:
        daily_limit = DAILY_LIMIT
    cutoff = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=LOOKBACK_DAYS - 1)
    grouped: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    for line in AUDIT_PATH.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
            timestamp = dt.datetime.fromisoformat(str(row.get("Utc", "")).replace("Z", "+00:00"))
        except Exception:
            continue
        if row.get("Type") != "tap-issued" or row.get("Result") != "success" or timestamp.date() < cutoff:
            continue
        target = str(row.get("Target") or "")
        if not target:
            continue
        grouped[(timestamp.date().isoformat(), target)].append({**row, "_timestamp": timestamp})

    identities: dict[str, dict[str, str]] = {}
    review_ids = {object_id for (_date, object_id), rows in grouped.items() if len(rows) >= REVIEW_THRESHOLD}
    if review_ids:
        token = graph_token(env)
        identities = {object_id: graph_user(token, object_id) for object_id in sorted(review_ids)}

    rows = []
    for (date, object_id), events in grouped.items():
        if len(events) < REVIEW_THRESHOLD:
            continue
        latest = max(events, key=lambda value: value["_timestamp"])
        identity = identities.get(object_id, {})
        self_service = sum(1 for event in events if event.get("Reason") == "student-self-service" or event.get("Actor") == object_id)
        rows.append({
            "date": date,
            "objectId": object_id,
            "displayName": identity.get("displayName", ""),
            "userPrincipalName": identity.get("userPrincipalName", ""),
            "studentId": identity.get("studentId", ""),
            "school": str(latest.get("School") or ""),
            "count": len(events),
            "selfServiceCount": self_service,
            "facultyCount": len(events) - self_service,
            "lastUtc": latest["_timestamp"].isoformat(),
        })

    report = {
        "generatedUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "policy": {"dailyLimit": daily_limit, "reviewThreshold": REVIEW_THRESHOLD},
        "rows": sorted(rows, key=lambda value: (value["date"], value["count"]), reverse=True),
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".mfa-tap-usage-", dir=OUTPUT_PATH.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)
            handle.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, OUTPUT_PATH)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    main()
