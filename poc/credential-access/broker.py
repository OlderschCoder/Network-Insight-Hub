"""Encrypted credential lifecycle. No model prompt, shell argument, or log gets a secret."""
from __future__ import annotations

import base64
import contextlib
import copy
import ctypes
import json
import os
from pathlib import Path
import secrets
import tempfile
from datetime import datetime, timezone
from uuid import uuid4

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AAD = b"SCCC-FRED-CREDENTIAL-POC-v1"


class AccessError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def b64(value):
    return base64.b64encode(value).decode("ascii")


def unb64(value):
    return base64.b64decode(value, validate=True)


def atomic(path: Path, content: bytes):
    """Same-volume replacement; the prior encrypted version survives failed writes."""
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def protect_windows(data: bytes, decrypt=False):
    """DPAPI CurrentUser: ordinary runtime key material is bound to this Windows user."""
    if os.name != "nt":
        raise AccessError("This pilot's runtime key protection requires Windows DPAPI")
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("length", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, destination = Blob(len(data), buffer), Blob()
    if decrypt:
        result = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 1, ctypes.byref(destination))
    else:
        result = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(source), "Fred credential POC", None, None, None, 1,
            ctypes.byref(destination))
    if not result:
        raise AccessError("Windows could not protect or unlock the runtime key")
    try:
        return ctypes.string_at(destination.data, destination.length)
    finally:
        ctypes.windll.kernel32.LocalFree(destination.data)


def seal(value, key):
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, json.dumps(value).encode(), AAD)
    return json.dumps({"format": 1, "nonce": b64(nonce), "ciphertext": b64(ciphertext)}).encode()


def unseal(raw, key):
    envelope = json.loads(raw)
    if envelope.get("format") != 1:
        raise AccessError("Unknown encrypted package format")
    return json.loads(AESGCM(key).decrypt(unb64(envelope["nonce"]),
                                        unb64(envelope["ciphertext"]), AAD))


@contextlib.contextmanager
def exclusive(path):
    """OS-released lock: a crashed process cannot leave the vault permanently locked."""
    with open(path, "a+b") as stream:
        stream.seek(0)
        if not stream.read(1):
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class Vault:
    def __init__(self, directory, key=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "credentials.vault"
        self.key = key
        if self.key is None:
            key_path = self.directory / ("runtime-key.dpapi" if os.name == "nt" else "runtime-key.secret")
            if key_path.exists():
                if os.name != "nt" and key_path.stat().st_mode & 0o077:
                    raise AccessError("Runtime key permissions must be 0600")
                self.key = (protect_windows(key_path.read_bytes(), decrypt=True)
                            if os.name == "nt" else key_path.read_bytes())
            else:
                if self.path.exists():
                    raise AccessError("Runtime key missing; use the offline recovery package")
                self.key = os.urandom(32)
                atomic(key_path, protect_windows(self.key) if os.name == "nt" else self.key)

    def read(self):
        if self.path.exists():
            return unseal(self.path.read_bytes(), self.key)
        return {"format": 1, "version": 0, "targets": {}, "audit": [], "outbox": []}

    def save(self, state):
        state["version"] += 1
        state["updatedAt"] = now()
        atomic(self.path, seal(state, self.key))
        # A failed recovery export MUST surface, while the durable vault preserves
        # the pending/current password and the audit event for reconciliation.
        if (self.directory / "recovery-public.pem").exists():
            self.export_recovery()

    def initialize_recovery(self):
        with exclusive(self.directory / "vault.lock"):
            paths = [self.directory / name for name in
                     ("recovery-private.pem", "recovery-public.pem", "recovery-unlock.vault")]
            if any(p.exists() for p in paths):
                if not all(p.exists() for p in paths):
                    raise AccessError("Incomplete recovery key set; review before proceeding")
                return
            private = rsa.generate_private_key(public_exponent=65537, key_size=3072)
            unlock = secrets.token_urlsafe(32).encode()
            atomic(paths[0], private.private_bytes(serialization.Encoding.PEM,
                   serialization.PrivateFormat.PKCS8, serialization.BestAvailableEncryption(unlock)))
            atomic(paths[1], private.public_key().public_bytes(serialization.Encoding.PEM,
                   serialization.PublicFormat.SubjectPublicKeyInfo))
            atomic(paths[2], seal({"unlock": unlock.decode()}, self.key))
            self.export_recovery()

    def export_recovery(self):
        public = serialization.load_pem_public_key(
            (self.directory / "recovery-public.pem").read_bytes())
        export_key = os.urandom(32)
        wrapped = public.encrypt(export_key, padding.OAEP(
            mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=AAD))
        state = self.read()
        package = {"format": 1, "version": state["version"], "createdAt": now(),
                   "wrappedKey": b64(wrapped), "vault": json.loads(seal(state, export_key))}
        atomic(self.directory / "safe.recovery.json", json.dumps(package).encode())

    def safe_test(self):
        """Exercise the independent recovery path, not the runtime AES key."""
        unlock = unseal((self.directory / "recovery-unlock.vault").read_bytes(), self.key)["unlock"].encode()
        recovered = recover(self.directory / "safe.recovery.json",
                            self.directory / "recovery-private.pem", unlock)
        if recovered != self.read():
            raise AccessError("Offline recovery package differs from the current vault")
        return {"verified": True, "version": recovered["version"],
                "targets": len(recovered["targets"])}


def recover(package_path, private_path, password):
    package = json.loads(Path(package_path).read_bytes())
    private = serialization.load_pem_private_key(Path(private_path).read_bytes(), password=password)
    key = private.decrypt(unb64(package["wrappedKey"]), padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=AAD))
    state = unseal(json.dumps(package["vault"]).encode(), key)
    if state["version"] != package["version"]:
        raise AccessError("Recovery package metadata failed verification")
    return state


def authorize(actor, owner=False):
    # The caller is supplied ONLY by the trusted Hub session verifier, never a
    # username/email/role from request JSON. Local emergency recovery is separate.
    if not actor or not actor.get("entraObjectId") or actor.get("isBreakGlass"):
        raise AccessError("An authenticated SSO team identity is required")
    if not actor.get("isActive") or actor.get("role") not in {"cio", "network", "network_engineer"}:
        raise AccessError("Credential access is not authorized")
    if owner and actor["role"] != "cio":
        raise AccessError("CIO authorization is required")
    return {k: actor[k] for k in ("id", "name", "email", "entraObjectId", "role")}


def event(state, actor, target, action):
    item = {"id": str(uuid4()), "at": now(), "actor": actor,
            "target": target, "action": action}
    state["audit"].append(item)
    # One transaction persists both the event and its notification obligation.
    if action in {"credential-issued", "reset-verified", "initial-password-verified", "rotation-failed-review-required"}:
        state["outbox"].append({**item, "status": "pending", "attempts": 0})


class Broker:
    def __init__(self, vault: Vault, adapter):
        self.vault, self.adapter = vault, adapter

    def stage(self, actor, target, current, replacement):
        actor = authorize(actor, owner=True)
        if not replacement or len(replacement) < 12 or any(c in replacement for c in "\r\n\x00"):
            raise AccessError("A single-line test password of at least 12 characters is required")
        with exclusive(self.vault.directory / "vault.lock"):
            state = self.vault.read()
            existing = state["targets"].get(target["ip"])
            if existing:
                raise AccessError("Target already enrolled; use its existing checkout/reset workflow")
            self.adapter.verify(target, current)
            record = {**copy.deepcopy(target), "current": current, "pending": replacement,
                      "state": "staged", "checkout": None}
            state["targets"][target["ip"]] = record
            event(state, actor, target["ip"], "initial-password-staged")
            self.vault.save(state)

    def apply_staged(self, actor, ip):
        actor = authorize(actor, owner=True)
        return self._rotate(actor, ip, initial=True)

    def checkout(self, actor, ip):
        actor = authorize(actor)
        with exclusive(self.vault.directory / "vault.lock"):
            state = self.vault.read()
            record = state["targets"][ip]
            if record["state"] != "ready" or record.get("checkout"):
                raise AccessError("Target is already checked out or requires recovery review")
            # Fresh login is proven before the password is issued.
            self.adapter.verify(record, record["current"])
            record["checkout"] = {"actorId": actor["id"], "at": now()}
            event(state, actor, ip, "credential-issued")
            self.vault.save(state)
            # Only the protected reveal response receives this value. Tool/model
            # responses must return a reveal action, never this password.
            return record["current"]

    def finish(self, actor, ip):
        actor = authorize(actor)
        with exclusive(self.vault.directory / "vault.lock"):
            state = self.vault.read()
            record = state["targets"][ip]
            checkout = record.get("checkout")
            if record["state"] != "ready" or not checkout:
                raise AccessError("No active checkout is available to return")
            if checkout["actorId"] != actor["id"] and actor["role"] != "cio":
                raise AccessError("Only the borrower or CIO may return this checkout")
            alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@%_-"
            record["pending"] = "Aa7!" + "".join(secrets.choice(alphabet) for _ in range(28))
            record["state"] = "reset-pending"
            event(state, actor, ip, "reset-staged")
            self.vault.save(state)
        return self._rotate(actor, ip)

    def _rotate(self, actor, ip, initial=False):
        with exclusive(self.vault.directory / "vault.lock"):
            state = self.vault.read()
            record = state["targets"][ip]
            expected = "staged" if initial else "reset-pending"
            if record["state"] != expected:
                raise AccessError("No applicable staged password exists")
            record["state"] = "applying"
            event(state, actor, ip, "rotation-started")
            self.vault.save(state)  # current AND candidate survive a crash before device I/O
            try:
                # Adapter retains its original session, changes only this account,
                # verifies new privilege, saves, reconnects, and verifies again.
                self.adapter.change(record, record["current"], record["pending"])
            except Exception:
                record["state"] = "review-required"
                event(state, actor, ip, "rotation-failed-review-required")
                self.vault.save(state)
                # Device output/exception text can contain echoed secrets.
                raise AccessError("Rotation incomplete; encrypted current and candidate retained") from None
            record["previous"] = record["current"]
            record["current"] = record.pop("pending")
            record["state"], record["checkout"] = "ready", None
            record["verifiedAt"] = now()
            event(state, actor, ip, "initial-password-verified" if initial else "reset-verified")
            self.vault.save(state)
            return {"ip": ip, "state": "ready", "verifiedAt": record["verifiedAt"],
                    "version": state["version"]}

    def report(self, actor):
        authorize(actor, owner=True)
        state = self.vault.read()
        # This allowlist is also the model-visible response shape.
        return {"version": state["version"], "targets": [
            {k: row.get(k) for k in ("name", "ip", "account", "platform", "state", "checkout", "verifiedAt")}
            for row in state["targets"].values()], "audit": state["audit"],
            "notifications": [{k: row[k] for k in ("id", "action", "status", "attempts")}
                              for row in state["outbox"]]}

    def deliver(self, send):
        """Sender failures retain a durable retryable obligation, without error text."""
        with exclusive(self.vault.directory / "vault.lock"):
            state = self.vault.read()
            for item in state["outbox"]:
                if item["status"] == "sent":
                    continue
                item["attempts"] += 1
                try:
                    send(copy.deepcopy(item))
                    item["status"] = "sent"
                except Exception:
                    item["status"] = "pending"
                self.vault.save(state)


class SimulatedDevice:
    def __init__(self, password):
        self.password, self.fail_after_change = password, False

    def verify(self, target, password):
        if not secrets.compare_digest(self.password, password):
            raise AccessError("Fresh login failed")

    def change(self, target, old, new):
        self.verify(target, old)
        self.password = new
        if self.fail_after_change:
            raise RuntimeError("Simulated loss after device accepted the change")
        self.verify(target, new)
