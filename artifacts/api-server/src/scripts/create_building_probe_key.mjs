// Run once on the server, with an explicit private path outside the release.
import { generateKeyPairSync, createHash } from "node:crypto";
import { openSync, writeFileSync, closeSync } from "node:fs";
import { isAbsolute } from "node:path";
const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) throw new Error("Provide an absolute private key path outside the web root.");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const file = openSync(destination, "wx", 0o600);
try { writeFileSync(file, privateKey.export({ format: "pem", type: "pkcs8" })); } finally { closeSync(file); }
console.log("Created separate probe signing key. Public SPKI SHA-256:", createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex"));
