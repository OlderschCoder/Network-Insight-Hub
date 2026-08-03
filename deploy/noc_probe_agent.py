#!/usr/bin/env python3
"""Restricted internal network probe for Fred.

The service exposes only typed ping and TCP-connect checks. It never invokes a
shell and accepts requests only from the configured App-Server2 address.
"""

import hmac
import ipaddress
import json
import os
import re
import socket
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


LISTEN_IP = os.environ.get("NOC_PROBE_LISTEN_IP", "10.0.0.22")
LISTEN_PORT = int(os.environ.get("NOC_PROBE_PORT", "9123"))
ALLOWED_CLIENT = os.environ.get("NOC_PROBE_ALLOWED_CLIENT", "10.0.0.44")
TOKEN = os.environ["NOC_PROBE_TOKEN"]
HOST_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,253}[A-Za-z0-9])?$")


def valid_target(target: str) -> bool:
    if not target or len(target) > 255 or not HOST_RE.fullmatch(target):
        return False
    try:
        address = ipaddress.ip_address(target)
        return not (address.is_loopback or address.is_link_local or address.is_unspecified)
    except ValueError:
        return True


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
        if self.client_address[0] not in {ALLOWED_CLIENT, "127.0.0.1"}:
            self.respond(403, {"error": "client not allowed"})
        elif self.path == "/health":
            self.respond(200, {"status": "ok", "vantage": LISTEN_IP})
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
        if self.path != "/v1/probe":
            self.respond(404, {"error": "not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 2 or size > 2048:
                raise ValueError("invalid body size")
            data = json.loads(self.rfile.read(size))
            operation = data.get("operation")
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


ThreadingHTTPServer((LISTEN_IP, LISTEN_PORT), ProbeHandler).serve_forever()
