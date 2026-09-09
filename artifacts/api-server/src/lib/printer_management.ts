import { isIPv4 } from "node:net";
import { z } from "zod";

export const PRINT_SERVER = "prntsp2.sccc.edu" as const;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const INVALID_SHARE_CHARACTERS = /[\\/[\]:|<>+=;,?*"\u0000-\u001f\u007f]/g;
const RESERVED_SHARE_NAME = /^(?:ADMIN\$|IPC\$|PRINT\$|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

const requiredText = (label: string, max: number) => z
  .string({ required_error: `${label} is required.` })
  .trim()
  .min(1, `${label} is required.`)
  .max(max, `${label} must be ${max} characters or fewer.`)
  .refine((value) => !CONTROL_CHARACTERS.test(value), `${label} contains unsupported control characters.`);

const optionalText = (label: string, max: number) => z
  .string()
  .trim()
  .max(max, `${label} must be ${max} characters or fewer.`)
  .refine((value) => !CONTROL_CHARACTERS.test(value), `${label} contains unsupported control characters.`)
  .default("");

export function isPrivatePrinterIPv4(value: string): boolean {
  if (!isIPv4(value)) return false;
  const [first, second] = value.split(".").map(Number);
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}
const installRequestSchema = z.object({
  name: requiredText("Printer name", 120).refine(
    (value) => !/[\\*?\[\]]/.test(value),
    "Printer name cannot contain a backslash or wildcard characters.",
  ),
  ip: requiredText("Printer IPv4 address", 15).refine(
    isIPv4,
    "Enter a valid printer IPv4 address.",
  ).refine(
    isPrivatePrinterIPv4,
    "Printer IPv4 address must be an RFC1918 campus address.",
  ),
  driver: requiredText("Printer driver", 240),
  location: optionalText("Location", 255),
  comment: optionalText("Comment", 1024),
}).strict();

export type PrinterInstallRequest = z.infer<typeof installRequestSchema>;

export type PrinterInstallResult = {
  created: boolean;
  printer: {
    name: string;
    driver: string;
    portName: string;
    shareName: string;
    uncPath: string;
    location: string;
    comment: string;
  };
};

type BridgeConfig = {
  baseUrl: string;
  token: string;
};

export class PrinterManagementError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 502 | 503,
    public readonly code: string,
    public readonly phase?: string,
  ) {
    super(message);
    this.name = "PrinterManagementError";
  }
}

function getBridgeConfig(): BridgeConfig | null {
  const rawUrl = process.env.PRINT_MANAGEMENT_URL?.trim();
  const token = process.env.PRINT_MANAGEMENT_TOKEN?.trim();
  if (!rawUrl || !token) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PrinterManagementError(
      "Printer management is configured with an invalid bridge URL.",
      503,
      "PRINTER_BRIDGE_MISCONFIGURED",
    );
  }
  const privateHttpAllowed = process.env.PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP?.trim().toLowerCase() === "true";
  const isFixedPrivateHost = ["10.0.0.30", PRINT_SERVER].includes(url.hostname.toLowerCase());
  if (
    !["http:", "https:"].includes(url.protocol)
    || !isFixedPrivateHost
    || (url.protocol === "http:" && !privateHttpAllowed)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || token.length < 32
  ) {
    throw new PrinterManagementError(
      "Printer management is configured with an invalid bridge URL.",
      503,
      "PRINTER_BRIDGE_MISCONFIGURED",
    );
  }

  return { baseUrl: url.origin, token };
}

export function isPrinterManagementConfigured(): boolean {
  try {
    return getBridgeConfig() !== null;
  } catch {
    return false;
  }
}

export function parsePrinterInstallRequest(input: unknown): PrinterInstallRequest {
  const parsed = installRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new PrinterManagementError(
      parsed.error.issues[0]?.message ?? "Invalid printer configuration.",
      400,
      "INVALID_PRINTER_CONFIGURATION",
      "validation",
    );
  }
  return parsed.data;
}

/**
 * Produce a Windows-compatible SMB share name without accepting a second,
 * client-controlled identity for the queue. The bridge repeats this check.
 */
export function printerShareName(name: string): string {
  const safe = name
    .normalize("NFKC")
    .replace(INVALID_SHARE_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  const truncated = Array.from(safe).slice(0, 80).join("").trim().replace(/[. ]+$/g, "");
  if (
    !truncated
    || !/[\p{L}\p{N}]/u.test(truncated)
    || truncated.endsWith("$")
    || RESERVED_SHARE_NAME.test(truncated)
  ) {
    throw new PrinterManagementError(
      "Printer name does not produce a valid Windows share name.",
      400,
      "INVALID_PRINTER_CONFIGURATION",
      "validation",
    );
  }
  return truncated;
}

function safeBridgeMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(CONTROL_CHARACTERS, " ").trim().slice(0, 500);
  return clean || fallback;
}

function safeBridgePhase(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/i.test(value)) return undefined;
  return value.toLowerCase();
}

function safeBridgeCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) {
    return "PRINTER_BRIDGE_ERROR";
  }
  return value;
}

async function requestBridge(path: "/v1/printers/drivers" | "/v1/printers", init?: RequestInit): Promise<unknown> {
  const config = getBridgeConfig();
  if (!config) {
    throw new PrinterManagementError(
      "Printer management is not configured. Set PRINT_MANAGEMENT_URL and PRINT_MANAGEMENT_TOKEN.",
      503,
      "PRINTER_BRIDGE_NOT_CONFIGURED",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(path.endsWith("/drivers") ? 30_000 : 120_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new PrinterManagementError(
      timedOut
        ? "The printer-management bridge timed out."
        : "The printer-management bridge is unavailable.",
      502,
      timedOut ? "PRINTER_BRIDGE_TIMEOUT" : "PRINTER_BRIDGE_UNAVAILABLE",
    );
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) {
    throw new PrinterManagementError(
      "The printer-management bridge returned an oversized response.",
      502,
      "INVALID_PRINTER_BRIDGE_RESPONSE",
    );
  }
  const responseText = await response.text();
  if (responseText.length > 1_000_000) {
    throw new PrinterManagementError(
      "The printer-management bridge returned an oversized response.",
      502,
      "INVALID_PRINTER_BRIDGE_RESPONSE",
    );
  }
  let body: any = null;
  try {
    body = JSON.parse(responseText);
  } catch {
    // The response is validated below; no upstream HTML or exception detail is exposed.
  }
  if (!response.ok) {
    const phase = safeBridgePhase(body?.error?.phase ?? body?.phase);
    const message = safeBridgeMessage(
      body?.error?.message ?? body?.message,
      `Printer management failed${phase ? ` during ${phase}` : ""}.`,
    );
    throw new PrinterManagementError(
      message,
      response.status === 400 ? 400 : response.status === 503 ? 503 : 502,
      safeBridgeCode(body?.error?.code ?? body?.code),
      phase,
    );
  }
  return body;
}

export async function listPrinterDrivers(): Promise<string[]> {
  const body = await requestBridge("/v1/printers/drivers") as any;
  if (body?.printServer !== PRINT_SERVER || !Array.isArray(body?.drivers)) {
    throw new PrinterManagementError(
      "The printer-management bridge returned an invalid driver catalog.",
      502,
      "INVALID_PRINTER_BRIDGE_RESPONSE",
    );
  }

  const unique = new Map<string, string>();
  for (const value of body.drivers.slice(0, 2_000)) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (!name || name.length > 240 || CONTROL_CHARACTERS.test(name)) continue;
    const key = name.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, name);
  }
  const drivers = Array.from(unique.values()).sort((a, b) => a.localeCompare(b, "en-US"));
  if (drivers.length === 0) {
    throw new PrinterManagementError(
      `No printer drivers are registered on ${PRINT_SERVER}.`,
      502,
      "NO_PRINTER_DRIVERS",
      "driver",
    );
  }
  return drivers;
}

export async function installPrinter(input: unknown): Promise<PrinterInstallResult> {
  const request = parsePrinterInstallRequest(input);
  const shareName = printerShareName(request.name);
  const body = await requestBridge("/v1/printers", {
    method: "POST",
    body: JSON.stringify({ ...request, shareName }),
  }) as any;

  const printer = body?.printer;
  if (
    typeof body?.created !== "boolean"
    || !printer
    || typeof printer.name !== "string"
    || typeof printer.driver !== "string"
    || typeof printer.portName !== "string"
    || typeof printer.shareName !== "string"
    || typeof printer.uncPath !== "string"
    || typeof printer.location !== "string"
    || typeof printer.comment !== "string"
    || printer.name !== request.name
    || printer.driver.toLocaleLowerCase("en-US") !== request.driver.toLocaleLowerCase("en-US")
    || printer.portName !== `IP_${request.ip}`
    || printer.shareName !== shareName
    || printer.uncPath !== `\\\\${PRINT_SERVER}\\${shareName}`
    || printer.location !== request.location
    || printer.comment !== request.comment
  ) {
    throw new PrinterManagementError(
      "The printer-management bridge could not verify the completed queue.",
      502,
      "INVALID_PRINTER_BRIDGE_RESPONSE",
      "verify",
    );
  }

  return {
    created: body.created,
    printer: {
      name: printer.name,
      driver: printer.driver,
      portName: printer.portName,
      shareName: printer.shareName,
      uncPath: printer.uncPath,
      location: printer.location,
      comment: printer.comment,
    },
  };
}
