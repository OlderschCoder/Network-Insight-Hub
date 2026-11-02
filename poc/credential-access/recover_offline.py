"""Independent recovery: Python + cryptography, no SSO, network or runtime key."""
import base64
import getpass
import json
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def main():
    root = Path(__file__).resolve().parent
    package = json.loads((root / "safe.recovery.json").read_bytes())
    password = getpass.getpass("Sealed-envelope recovery password: ").encode()
    aad = b"SCCC-FRED-CREDENTIAL-POC-v1"
    private = serialization.load_pem_private_key((root / "recovery-private.pem").read_bytes(), password)
    key = private.decrypt(base64.b64decode(package["wrappedKey"]), padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=aad))
    envelope = package["vault"]
    value = json.loads(AESGCM(key).decrypt(base64.b64decode(envelope["nonce"]),
                                         base64.b64decode(envelope["ciphertext"]), aad))
    if package["version"] != value["version"]:
        raise ValueError("Recovery version failed verification")
    print("Recovery version:", value["version"], "Updated:", value.get("updatedAt"))
    for ip, row in value["targets"].items():
        print(ip, row["name"], row["account"], row["state"])
    selected = input("Device IP to recover (blank exits): ").strip()
    if selected in value["targets"]:
        row = value["targets"][selected]
        # Explicit local emergency reveal. Do not run in a transcript or AI tool.
        for name in ("current", "pending", "previous"):
            if row.get(name):
                print(name + ":", row[name])


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Recovery failed. Verify the package, private key, and envelope password.")
