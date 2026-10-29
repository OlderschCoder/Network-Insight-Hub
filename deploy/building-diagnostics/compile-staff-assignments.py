#!/usr/bin/env python3
"""Compile a staff TSV into private exact-account building assignments."""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import re


def room_building(room: str, title: str) -> str | None:
    value = re.sub(r"\s+", "", room or "").upper()
    if room.strip().lower() == "west campus": return "West Campus"
    if room.strip().lower() == "epworth" or re.fullmatch(r"E\d+[A-Z]?", value): return "Industrial Technology Campus"
    if re.fullmatch(r"AA?\d+[A-Z]?", value): return "Hobble"
    if re.fullmatch(r"AH\d+[A-Z]?", value): return "Allied Health"
    if re.fullmatch(r"COS\d+[A-Z]?", value): return "Cosmetology"
    if value == "HC" or re.fullmatch(r"HC\d+[A-Z]?", value): return "Student Health Center"
    if re.fullmatch(r"H\d+[A-Z]?", value): return "Humanities"
    if re.fullmatch(r"M\d+[A-Z]?", value) or value == "B101": return "Maintenance Building"
    if re.fullmatch(r"V\d+[A-Z]?", value): return "Agriculture"
    if re.fullmatch(r"SU\d+[A-Z]?", value) or re.fullmatch(r"SW\d+[A-Z]?", value): return "Student Union"
    if re.fullmatch(r"SA\d+[A-Z]?", value): return "Student Activities"
    if re.fullmatch(r"TA\d+[A-Z]?", value): return "Tech Building A"
    if re.fullmatch(r"TB\d+[A-Z]?", value): return "Tech Building B"
    if re.fullmatch(r"TD\d+[A-Z]?", value): return "Tech Building D"
    if re.fullmatch(r"TT\d+[A-Z]?", value): return "Tech Building T"
    if re.fullmatch(r"T\d+[A-Z]?", value): return "Industrial Technology Campus"
    if value.startswith("SC") and "baseball" in title.lower(): return "Baseball Field"
    if value.startswith("SC") and "softball" in title.lower(): return "Softball Field"
    return None


def compile_rows(path: Path, aliases: dict[str, list[str]]) -> tuple[list[dict], list[dict]]:
    assignments, unresolved = {}, []
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        for fields in csv.reader(source, delimiter="\t"):
            if len(fields) < 6 or "@" not in fields[-1]:
                continue
            name, title, _department, _phone, room, email = (field.strip() for field in fields[:6])
            building = room_building(room, title)
            local, domain = email.lower().rsplit("@", 1)
            if domain not in {"sccc.edu", "g.sccc.edu"} or not re.fullmatch(r"[a-z0-9._-]+", local):
                unresolved.append({"name": name, "room": room, "reason": "invalid-email"})
                continue
            if not building:
                unresolved.append({"name": name, "room": room, "reason": "unmapped-location"})
                continue
            accounts = [local, *aliases.get(email.lower(), [])]
            for account in accounts:
                if not re.fullmatch(r"[a-z0-9._-]+", account.lower()):
                    raise ValueError("Alias must be an exact account name")
                username = "sccc\\" + account.lower()
                if username in assignments and assignments[username] != building:
                    raise ValueError("Conflicting staff assignment for " + username)
                assignments[username] = building
    return ([{"username": username, "building": building} for username, building in sorted(assignments.items())], unresolved)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--alias", action="append", default=[], metavar="EMAIL=ACCOUNT")
    args = parser.parse_args()
    aliases: dict[str, list[str]] = {}
    for item in args.alias:
        email, separator, account = item.partition("=")
        if not separator: raise SystemExit("Alias must be EMAIL=ACCOUNT")
        aliases.setdefault(email.strip().lower(), []).append(account.strip().lower())
    rows, unresolved = compile_rows(args.input, aliases)
    value = {"schema": "sccc.staff-building-assignments.v1", "generatedAt": datetime.now(timezone.utc).isoformat(), "assignments": rows}
    args.output.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"assignments": len(rows), "unresolved": len(unresolved), "unresolvedRows": unresolved}, indent=2))


if __name__ == "__main__":
    main()
