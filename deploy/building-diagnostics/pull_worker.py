#!/usr/bin/env python3
"""Private NOC worker: publish trusted inventory and pull diagnostic results.

No listener is opened. The only outbound destination is the configured Fred HTTPS
origin. Diagnostic credentials and the local inventory are never sent to agents.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

API = "/api/building-diagnostics"
MAX_SOURCE_BYTES = 12 * 1024 * 1024
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_REPORTS_RETAINED = 10000
MAX_PAGES = 20


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Timestamp is required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp requires UTC offset")
    return parsed.astimezone(timezone.utc)


def validate_origin(value: str) -> str:
    parts = urlsplit(value)
    if (parts.scheme != "https" or not parts.hostname or parts.username or
            parts.password or parts.query or parts.fragment or parts.path not in ("", "/")):
        raise ValueError("Fred must be a single HTTPS origin without credentials or path")
    if parts.port not in (None, 443):
        raise ValueError("Fred HTTPS port must be 443")
    return value.rstrip("/")


def check_private_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected a regular protected file")
    info = path.stat()
    if os.name == "posix" and (stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError("Inventory and state files must have mode 0600 or 0400")
    if os.name == "posix" and info.st_uid not in (0, os.getuid()):
        raise ValueError("File owner must be root or the worker account")


def read_json(path: Path, max_bytes: int = MAX_SOURCE_BYTES) -> dict:
    check_private_file(path)
    with path.open("rb") as source:
        raw = source.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError("Input exceeds configured size bound")
    result = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(result, dict):
        raise ValueError("Expected a JSON object")
    return result


def validate_inventory(data: dict, now: datetime | None = None) -> dict:
    now = now or utc_now()
    ad_observed_at = data.get("adObservedAt", data.get("generatedAt"))
    age = (now - timestamp(ad_observed_at)).total_seconds()
    if age < -30 or age > 86400:
        raise ValueError("AD inventory must be a complete export within the last 24 hours")
    if data.get("snapshotComplete") is not True:
        raise ValueError("Incomplete inventory cannot replace the trusted snapshot")
    for key, maximum in (("adComputers", 30000), ("observations", 60000),
                         ("userBuildingAssignments", 30000)):
        rows = data.get(key)
        if not isinstance(rows, list) or len(rows) > maximum:
            raise ValueError("Missing or excessive inventory rows: " + key)
        if any(not isinstance(row, dict) for row in rows):
            raise ValueError("Inventory rows must be objects")
    if not data["adComputers"]:
        raise ValueError("Empty AD roster rejected")
    # Reject malformed and future evidence. Expired network observations are left
    # out; they must not be refreshed merely because the worker ran again.
    observations = []
    for row in data["observations"]:
        evidence_age = (now - timestamp(row.get("observedAt"))).total_seconds()
        if evidence_age < -30:
            raise ValueError("Network observation is in the future")
        if evidence_age <= 600 and row.get("edge") is True:
            observations.append(row)
    assignments = []
    for row in data["userBuildingAssignments"]:
        assignment_age = (now - timestamp(row.get("observedAt"))).total_seconds()
        if assignment_age < -30:
            raise ValueError("User assignment is in the future")
        if assignment_age <= 30 * 86400:
            assignments.append(row)
    result = {"snapshotComplete": True, "adObservedAt": ad_observed_at, "adComputers": data["adComputers"],
              "observations": observations, "userBuildingAssignments": assignments}
    status = data.get("collectorStatus")
    if status is not None:
        if not isinstance(status, dict) or set(status) != {"observedAt", "status", "switchesObserved", "portObservations", "wifiObservations"} or status["status"] not in ("ok", "degraded"):
            raise ValueError("Invalid collector status")
        age = (now - timestamp(status["observedAt"])).total_seconds()
        if age < -30:
            raise ValueError("Future collector status")
        for name, maximum in (("switchesObserved", 1000), ("portObservations", 60000), ("wifiObservations", 60000)):
            value = status.get(name)
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
                raise ValueError("Invalid collector count")
        result["collectorStatus"] = dict(status)
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Redirect refused; worker credentials stay on Fred's origin")


class FredClient:
    def __init__(self, origin: str, token: str):
        self.origin = validate_origin(origin)
        if not token or len(token) < 32 or any(ch.isspace() for ch in token):
            raise ValueError("A dedicated random worker credential of at least 32 characters is required")
        self.token = token
        self.opener = build_opener(NoRedirect())

    def request(self, path: str, payload: dict | None = None) -> dict:
        if not path.startswith(API + "/"):
            raise ValueError("Unexpected API path")
        body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        if body is not None and len(body) > MAX_SOURCE_BYTES:
            raise ValueError("Inventory exceeds request size bound")
        request = Request(self.origin + path, data=body,
                          method="GET" if body is None else "POST",
                          headers={"Authorization": "Bearer " + self.token,
                                   "Content-Type": "application/json",
                                   "Accept": "application/json"})
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            # Never print response bodies, URLs with query strings, or headers.
            raise RuntimeError("Fred rejected request with HTTP " + str(error.code)) from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("Fred response exceeded the size limit")
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError("Fred response is not an object")
        return result


def atomic_write(path: Path, data: bytes) -> None:
    if not path.parent.is_dir() or path.parent.is_symlink():
        raise ValueError("Create a protected state directory before starting the worker")
    if os.name == "posix" and stat.S_IMODE(path.parent.stat().st_mode) & 0o077:
        raise ValueError("State directory must have mode 0700")
    handle, temporary = tempfile.mkstemp(prefix=".building-diagnostics-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        if os.name == "posix":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sequence(value: object) -> int:
    if isinstance(value, bool) or not str(value).isdigit():
        raise ValueError("Report sequence must be a nonnegative decimal integer")
    result = int(str(value))
    if result < 0 or result > 9223372036854775807:
        raise ValueError("Invalid report sequence")
    return result


def merge_page(state: dict, page: dict) -> dict:
    cursor = sequence(state.get("cursor", "0"))
    next_cursor = sequence(page.get("nextCursor"))
    rows = page.get("reports")
    if not isinstance(rows, list) or len(rows) > 100 or next_cursor < cursor:
        raise ValueError("Invalid report page")
    known = {sequence(row["seq"]): row for row in state.get("reports", [])}
    incoming_sequences = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid report row")
        seq = sequence(row.get("seq"))
        if seq <= 0 or seq > next_cursor:
            raise ValueError("Report sequence is outside its page cursor")
        incoming_sequences.append(seq)
        if seq in known and known[seq] != row:
            raise ValueError("Conflicting replay of an existing report")
        known[seq] = row
    if incoming_sequences != sorted(set(incoming_sequences)):
        raise ValueError("Report page must have unique ascending sequences")
    if incoming_sequences and max(incoming_sequences) != next_cursor:
        raise ValueError("Page cursor skipped unreturned report records")
    if not incoming_sequences and next_cursor != cursor:
        raise ValueError("Empty report page must retain the cursor")
    retained = [known[key] for key in sorted(known)[-MAX_REPORTS_RETAINED:]]
    return {"schema": "sccc.building-diagnostics.results.v1",
            "cursor": str(next_cursor), "updatedAt": utc_now().isoformat(), "reports": retained}


def export_jsonl(path: Path, state: dict) -> None:
    # The snapshot is the checkpoint of record. If interrupted between these two
    # atomic replaces, the next run rebuilds the derived JSONL before pulling.
    content = "".join(json.dumps(row, separators=(",", ":")) + "\n"
                      for row in state.get("reports", []))
    atomic_write(path, content.encode("utf-8"))


def run_once(client: FredClient, inventory_path: Path, state_path: Path) -> dict:
    inventory = validate_inventory(read_json(inventory_path))
    client.request(API + "/inventory", inventory)
    state = (read_json(state_path, 32 * 1024 * 1024) if state_path.exists()
             else {"cursor": "0", "reports": []})
    jsonl_path = state_path.with_suffix(".jsonl")
    export_jsonl(jsonl_path, state)
    fetched = 0
    for _ in range(MAX_PAGES):
        page = client.request(API + "/reports?" + urlencode({"after": state["cursor"], "limit": 100}))
        updated = merge_page(state, page)
        fetched += len(page["reports"])
        atomic_write(state_path, json.dumps(updated, separators=(",", ":")).encode())
        export_jsonl(jsonl_path, updated)
        previous_cursor, state = state["cursor"], updated
        if len(page["reports"]) < 100 or state["cursor"] == previous_cursor:
            break
    return {"ok": True, "fetched": fetched, "cursor": state["cursor"],
            "retained": len(state["reports"])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    try:
        client = FredClient(os.environ.get("BUILDING_DIAGNOSTICS_FRED_ORIGIN", ""),
                            os.environ.get("BUILDING_DIAGNOSTICS_WORKER_TOKEN", ""))
        print(json.dumps(run_once(client, args.inventory, args.state)))
        return 0
    except Exception as error:
        # Exception messages from a network library may include credentials or
        # sensitive inventory. Only known safe messages are reported.
        print("Building diagnostics worker failed (" + type(error).__name__ + "). "
              "No success or freshness was recorded.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
