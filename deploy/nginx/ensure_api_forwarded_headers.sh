#!/usr/bin/env bash
set -Eeuo pipefail

readonly CONFIG=/etc/nginx/sites-enabled/appserver2
readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
readonly BACKUP="${CONFIG}.pre-telemetry-${STAMP}"

cp -a "$CONFIG" "$BACKUP"

rollback() {
  cp -a "$BACKUP" "$CONFIG"
}
trap rollback ERR

python3 - "$CONFIG" <<'PY'
import os
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
start = text.index("\tlocation /api/ {")
end = text.index("\n\t}", start) + len("\n\t}")
block = text[start:end]

if "proxy_set_header X-Forwarded-For" not in block:
    proxy = "\t    proxy_pass http://127.0.0.1:8080;"
    replacement = "\n".join(
        (
            proxy,
            "\t    proxy_set_header Host $host;",
            "\t    proxy_set_header X-Real-IP $remote_addr;",
            "\t    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
            "\t    proxy_set_header X-Forwarded-Proto $scheme;",
        )
    )
    if block.count(proxy) != 1:
        raise SystemExit("Expected exactly one API proxy_pass directive")
    block = block.replace(proxy, replacement)
    updated = text[:start] + block + text[end:]
    temporary = path.with_name(path.name + ".new")
    temporary.write_text(updated, encoding="utf-8")
    stat = path.stat()
    os.chmod(temporary, stat.st_mode)
    os.chown(temporary, stat.st_uid, stat.st_gid)
    os.replace(temporary, path)
PY

nginx -t
systemctl reload nginx
trap - ERR

printf 'NGINX_RELOADED=yes\nBACKUP=%s\n' "$BACKUP"
