"""Loopback-only POC sidecar. The existing Hub session authenticates every request."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import ssl
import urllib.request
import urllib.error
import smtplib
from email.message import EmailMessage
from broker import AccessError, Broker, Vault, authorize, atomic, seal, unseal
from aruba_adapter import ArubaAdapter

TARGET = {"name": "AA151-CIO", "ip": "192.168.252.173", "platform": "aruba_aoscx", "account": "admin"}


def load_env(path):
    values = {}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise AccessError("Unexpected authentication redirect")


def verify_session(token):
    if not token or len(token) > 4096 or any(c in token for c in "\r\n"):
        raise AccessError("Sign in through the Hub's Microsoft SSO first")
    # Fixed local Hub endpoint. Never forward a bearer token to a caller-supplied URL.
    request = urllib.request.Request("http://127.0.0.1:8080/api/auth/me",
                                     headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
            actor = json.load(response)
    except Exception:
        raise AccessError("Hub SSO session is missing, expired, or unavailable") from None
    authorize(actor)
    return actor


def build(directory, config):
    vault = Vault(directory)
    vault.initialize_recovery()
    adapter = ArubaAdapter("10.0.0.22", config["NOC_User"], config["NOC_Pwrd"],
                           Path(directory) / "known_hosts")
    broker = Broker(vault, adapter)

    def backup(text):
        # Called while Broker holds its vault lock, before changing the account.
        atomic(Path(directory) / "pilot-before.vault", seal({"target": TARGET, "config": text}, vault.key))
    adapter.backup = backup
    return broker


def notifier(config):
    def send(event):
        if not all(config.get(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASS")):
            raise AccessError("Notification transport not configured; retained in outbox")
        message = EmailMessage()
        message["To"] = "mark.bojeun@sccc.edu"
        message["From"] = config.get("SMTP_FROM") or config["SMTP_USER"]
        message["Subject"] = "[Fred credential POC] " + event["action"] + " — AA151-CIO"
        message["Message-ID"] = "<fred-credential-" + event["id"] + "@sccc.edu>"
        who = event["actor"]
        message.set_content(f"Mark,\n\n{who['name']} ({who['email']}) performed {event['action']} "
                            f"for AA151-CIO ({event['target']}) at {event['at']}.\n"
                            "This is the authorized credential-access pilot. No password is included.\n")
        port = int(config.get("SMTP_PORT") or 587)
        if port == 465:
            client = smtplib.SMTP_SSL(config["SMTP_HOST"], port, timeout=15, context=ssl.create_default_context())
        else:
            client = smtplib.SMTP(config["SMTP_HOST"], port, timeout=15)
        with client:
            if port != 465:
                client.starttls(context=ssl.create_default_context())
            client.login(config["SMTP_USER"], config["SMTP_PASS"])
            client.send_message(message)
    return send


def handler(broker, config):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # no URLs, headers, bodies, tokens, passwords, or device output in access logs

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self.dispatch()

        def do_POST(self):
            self.dispatch()

        def dispatch(self):
            try:
                header = self.headers.get("Authorization", "")
                if not header.startswith("Bearer "):
                    raise AccessError("Sign in through Microsoft SSO")
                actor = verify_session(header[7:])
                action = self.path.removeprefix("/api/fred-credentials-poc/")
                if self.command == "GET" and action == "status":
                    result = broker.report(actor)
                elif self.command == "POST":
                    if self.headers.get("Content-Type") != "application/json":
                        raise AccessError("JSON request required")
                    length = int(self.headers.get("Content-Length", "0"))
                    if length < 2 or length > 4096:
                        raise AccessError("Invalid request size")
                    body = json.loads(self.rfile.read(length))
                    if body.get("target") != TARGET["ip"]:
                        raise AccessError("Only the approved CIO office pilot may be changed")
                    if action == "enroll":
                        authorize(actor, owner=True)
                        current = config["CURRENT_ADMIN_PASSWORD"]
                        replacement = config["Default_test_pass"]
                        if config.get("Default_test_user") != "admin":
                            raise AccessError("Test account must match the approved existing admin")
                        broker.stage(actor, TARGET, current, replacement)
                        result = broker.apply_staged(actor, TARGET["ip"])
                    elif action == "reveal":
                        result = {"password": broker.checkout(actor, TARGET["ip"])}
                    elif action == "finish":
                        result = broker.finish(actor, TARGET["ip"])
                    elif action == "retry-notifications":
                        authorize(actor, owner=True)
                        result = {"status": "notification retry completed"}
                    elif action == "verify-recovery":
                        authorize(actor, owner=True)
                        result = broker.vault.safe_test()
                    else:
                        raise AccessError("Unknown POC action")
                    broker.deliver(notifier(config))
                else:
                    raise AccessError("Unknown POC action")
                self.reply(200, result)
            except AccessError as error:
                self.reply(403, {"error": str(error)})
            except Exception:
                self.reply(409, {"error": "Operation incomplete; inspect the protected vault and nonsecret status"})
    return Handler


if __name__ == "__main__":
    os.umask(0o077)
    directory = Path(os.environ["FRED_POC_STATE"])
    vault = Vault(directory)
    config = unseal((directory / "configuration.vault").read_bytes(), vault.key)
    broker = build(directory, config)
    HTTPServer(("127.0.0.1", 9137), handler(broker, config)).serve_forever()
