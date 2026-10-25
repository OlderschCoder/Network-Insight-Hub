import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_HOST = "ITADMIN@10.0.0.22";
const DEFAULT_KEY = "/home/scccadmin/.ssh/fred_network_enrollment_ed25519";

export function isPrivateIpv4(value: string) {
  if (isIP(value) !== 4) return false;
  const parts = value.split(".").map(Number);
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function parseRemoteJson(output: unknown) {
  const lines = String(output ?? "").trim().split(/\r?\n/).filter(Boolean);
  const last = lines.at(-1);
  if (!last) throw new Error("Switch enrollment service returned no result");
  try {
    return JSON.parse(last);
  } catch {
    throw new Error("Switch enrollment service returned an invalid result");
  }
}

export async function runSwitchEnrollment(
  request: Record<string, unknown>,
  timeoutMs: number,
) {
  const host = process.env.SWITCH_ENROLLMENT_HOST || DEFAULT_HOST;
  const key = process.env.SWITCH_ENROLLMENT_KEY || DEFAULT_KEY;
  if (host !== DEFAULT_HOST) throw new Error("Switch enrollment host is not approved");
  if (!key.startsWith("/") || /[\r\n]/.test(key)) throw new Error("Switch enrollment key path is invalid");
  const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64url");
  const args = [
    "-i", key,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=10",
    host,
    `switch-enrollment ${encoded}`,
  ];
  try {
    const { stdout } = await execFileAsync("/usr/bin/ssh", args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return parseRemoteJson(stdout);
  } catch (error: any) {
    try {
      const remote = parseRemoteJson(error?.stdout);
      throw new Error(String(remote?.error || "Switch enrollment failed"));
    } catch (parsedError: any) {
      if (parsedError?.message && parsedError.message !== "Switch enrollment service returned no result") {
        throw parsedError;
      }
      throw new Error(error?.killed ? "Switch enrollment timed out" : "Switch enrollment service is unavailable");
    }
  }
}
