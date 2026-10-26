export const DIAGNOSTICS_SSO_ATTEMPT_KEY = "diagnostics_sso_attempted";

export function diagnosticsSsoTarget(value: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://insights.sccc.edu");
    if (url.origin !== "https://insights.sccc.edu" || url.pathname !== "/network/diagnostics" || url.searchParams.get("sso") !== "1") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}

export function diagnosticGuid(value: string | null | undefined): string | null {
  return value && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) &&
    !/^0{8}(?:-0{4}){3}-0{12}$/.test(value) ? value.toLowerCase() : null;
}

export function diagnosticsSsoNavigation(target: string, loginOrigin: string | null | undefined, currentOrigin: string): string {
  const safeTarget = diagnosticsSsoTarget(target);
  if (!safeTarget) throw new Error("The diagnostics return address could not be verified.");
  if (!loginOrigin) throw new Error("Microsoft sign-in's registered HTTPS address is not available. Contact IT.");
  let canonical: URL;
  try { canonical = new URL(loginOrigin); } catch { throw new Error("Microsoft sign-in's registered HTTPS address could not be verified."); }
  if (canonical.protocol !== "https:" || canonical.username || canonical.password || canonical.pathname !== "/" || canonical.search || canonical.hash) {
    throw new Error("Microsoft sign-in's registered HTTPS address could not be verified.");
  }
  return canonical.origin === currentOrigin ? "/api/auth/entra/login" : `${canonical.origin}${safeTarget}`;
}

type DiagnosticCandidate = { deviceId: string | null; enrolled: boolean; online: boolean; adVerified: boolean; capabilities?: string[]; revoked?: boolean };
export function diagnosticIneligibility(device: DiagnosticCandidate, type: string): string | null {
  if (device.revoked) return "Diagnostic credential revoked";
  if (!device.adVerified) return "Current AD verification required";
  if (!device.enrolled || !device.deviceId) return "Diagnostic agent not enrolled";
  if (!device.online) return "No recent authenticated check-in";
  if (type !== "fred" && !device.capabilities?.includes("external-probe-v2")) return "Update the diagnostic agent for external measurements";
  return null;
}
