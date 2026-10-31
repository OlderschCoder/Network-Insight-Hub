import { spawn } from "node:child_process";
import net from "node:net";

/**
 * Active network-diagnostic helpers the AI assistant can run on behalf of IT
 * staff (ping / TCP port reachability). These probe live hosts, so every entry
 * point validates input strictly (no shell, no argument injection) and bounds
 * execution time to keep them safe to expose to the model.
 *
 * Reachability semantics: `ok` means the probe itself ran; `reachable`/`open`
 * report the actual result. Internal/private targets only resolve when the
 * server is on the SCCC network or VPN (same constraint as the FortiGate tool).
 */

// Hostnames and IPv4/IPv6 literals only — no spaces, no shell metacharacters,
// and never a leading "-" (which could be parsed as a ping/socket flag).
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9._:-]{0,253}[A-Za-z0-9])?$/;

export function isValidHost(host: string): boolean {
  if (!host || host.length > 255) return false;
  if (host.startsWith("-")) return false;
  return HOST_RE.test(host);
}

export interface PingResult {
  ok: boolean;
  host: string;
  reachable: boolean;
  output: string;
  error?: string;
}

/** ICMP ping via the system `ping` binary (spawned without a shell). */
export async function pingHost(
  host: string,
  count = 4,
  opts: { deadlineSec?: number; killMs?: number } = {},
): Promise<PingResult> {
  const cleanHost = (host ?? "").trim();
  if (!isValidHost(cleanHost)) {
    return { ok: false, host: cleanHost, reachable: false, output: "", error: "invalid host" };
  }
  const n = Math.min(Math.max(Number.isInteger(count) ? count : 4, 1), 8);
  const deadlineSec = Math.min(Math.max(opts.deadlineSec ?? 6, 1), 20);
  const killMs = Math.min(Math.max(opts.killMs ?? 9000, 1000), 25000);

  return await new Promise<PingResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (res: PingResult) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };

    // Linux ping: -c <count> echo requests, -w <deadline> total seconds.
    const child = spawn("ping", ["-c", String(n), "-w", String(deadlineSec), cleanHost], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const killTimer = setTimeout(() => child.kill("SIGKILL"), killMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 8000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err: any) => {
      clearTimeout(killTimer);
      finish({
        ok: false,
        host: cleanHost,
        reachable: false,
        output: stdout.trim(),
        error:
          err?.code === "ENOENT"
            ? "ping command is not available on this server"
            : String(err?.message ?? err),
      });
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      // ping exit codes: 0 = host replied, 1 = no reply, 2 = error.
      finish({
        ok: code !== 2,
        host: cleanHost,
        reachable: code === 0,
        output: (stdout || stderr).trim().slice(0, 4000),
      });
    });
  });
}

export interface TcpResult {
  ok: boolean;
  host: string;
  port: number;
  open: boolean;
  latencyMs?: number;
  error?: string;
}

/** TCP connectivity test to host:port (equivalent to Test-NetConnection -Port). */
export async function testNetConnection(
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<TcpResult> {
  const cleanHost = (host ?? "").trim();
  if (!isValidHost(cleanHost)) {
    return { ok: false, host: cleanHost, port, open: false, error: "invalid host" };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, host: cleanHost, port, open: false, error: "invalid port" };
  }

  return await new Promise<TcpResult>((resolve) => {
    const start = Date.now();
    let settled = false;
    const socket = new net.Socket();
    const finish = (res: TcpResult) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(res);
    };

    socket.setTimeout(Math.min(Math.max(timeoutMs, 1000), 10000));
    socket.once("connect", () =>
      finish({ ok: true, host: cleanHost, port, open: true, latencyMs: Date.now() - start }),
    );
    socket.once("timeout", () =>
      finish({ ok: true, host: cleanHost, port, open: false, error: "timed out" }),
    );
    socket.once("error", (err: any) =>
      finish({ ok: true, host: cleanHost, port, open: false, error: err?.code || String(err?.message ?? err) }),
    );
    socket.connect(port, cleanHost);
  });
}

export interface HostScanResult {
  host: string;
  label?: string;
  reachable: boolean;
  error?: string;
}

/**
 * On-prem health sweep: ping many hosts with bounded concurrency and tight
 * per-host timeouts so the AI can size up an outage across the inventory in one
 * shot. Preserves input order in the returned array. Callers must cap the number
 * of targets before calling (this fans out real probes).
 */
export async function pingHosts(
  targets: { host: string; label?: string }[],
  opts: { concurrency?: number; count?: number; deadlineSec?: number } = {},
): Promise<HostScanResult[]> {
  const concurrency = Math.min(Math.max(opts.concurrency ?? 16, 1), 32);
  const count = Math.min(Math.max(opts.count ?? 1, 1), 3);
  const deadlineSec = Math.min(Math.max(opts.deadlineSec ?? 2, 1), 5);
  const results: HostScanResult[] = new Array(targets.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= targets.length) return;
      const t = targets[i];
      if (!isValidHost((t.host ?? "").trim())) {
        results[i] = { host: t.host, label: t.label, reachable: false, error: "invalid host" };
        continue;
      }
      const r = await pingHost(t.host, count, { deadlineSec, killMs: (deadlineSec + 1) * 1000 });
      results[i] = { host: t.host, label: t.label, reachable: r.reachable, error: r.error };
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, targets.length) }, () => worker());
  await Promise.all(pool);
  return results;
}
