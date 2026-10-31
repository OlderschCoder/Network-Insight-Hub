import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRINT_SERVER,
  PrinterManagementError,
  installPrinter,
  isPrivatePrinterIPv4,
  listPrinterDrivers,
  parsePrinterInstallRequest,
  printerShareName,
} from "./printer_management";

const originalUrl = process.env.PRINT_MANAGEMENT_URL;
const originalToken = process.env.PRINT_MANAGEMENT_TOKEN;
const originalPrivateHttp = process.env.PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP;

describe("printer management", () => {
  beforeEach(() => {
    process.env.PRINT_MANAGEMENT_URL = "https://prntsp2.sccc.edu:9124";
    process.env.PRINT_MANAGEMENT_TOKEN = "test-only-token-32-characters-long";
    delete process.env.PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalUrl === undefined) delete process.env.PRINT_MANAGEMENT_URL;
    else process.env.PRINT_MANAGEMENT_URL = originalUrl;
    if (originalToken === undefined) delete process.env.PRINT_MANAGEMENT_TOKEN;
    else process.env.PRINT_MANAGEMENT_TOKEN = originalToken;
    if (originalPrivateHttp === undefined) delete process.env.PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP;
    else process.env.PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP = originalPrivateHttp;
  });

  it("strictly validates the client request and rejects a client-supplied server", () => {
    expect(() => parsePrinterInstallRequest({
      name: "West Sharp Copier",
      ip: "172.25.0.125",
      driver: "SHARP BP-50C26 PCL6",
      location: "Truck Driving Office Hallway",
      comment: "",
      printServer: "attacker.example",
    })).toThrowError(PrinterManagementError);

    expect(() => parsePrinterInstallRequest({
      name: "West Sharp Copier",
      ip: "999.25.0.125",
      driver: "SHARP BP-50C26 PCL6",
      location: "",
      comment: "",
    })).toThrow("Enter a valid printer IPv4 address");
  });

  it("permits only RFC1918 printer targets", () => {
    expect(["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.10"].every(isPrivatePrinterIPv4)).toBe(true);
    expect(["8.8.8.8", "127.0.0.1", "169.254.10.2", "172.32.0.1", "224.0.0.1"].some(isPrivatePrinterIPv4)).toBe(false);
    expect(() => parsePrinterInstallRequest({
      name: "Not a campus printer",
      ip: "8.8.8.8",
      driver: "SHARP BP-50C26 PCL6",
      location: "",
      comment: "",
    })).toThrow("RFC1918 campus address");
  });

  it("derives a bounded Windows-safe share name", () => {
    expect(printerShareName(" West / Sharp: Copier? ")).toBe("West - Sharp- Copier-");
    expect(printerShareName("x".repeat(100))).toHaveLength(80);
    expect(() => printerShareName("///???")).toThrow("valid Windows share name");
    expect(() => printerShareName("print$ ")).toThrow("valid Windows share name");
    expect(() => printerShareName("LPT1")).toThrow("valid Windows share name");
  });

  it("loads, cleans, deduplicates, and sorts the fixed server driver catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      printServer: PRINT_SERVER,
      drivers: ["SHARP Universal PCL6", "  Microsoft IPP Class Driver ", "sharp universal pcl6", null],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPrinterDrivers()).resolves.toEqual([
      "Microsoft IPP Class Driver",
      "SHARP Universal PCL6",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://prntsp2.sccc.edu:9124/v1/printers/drivers",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-only-token-32-characters-long" }),
      }),
    );
  });

  it("rejects arbitrary plain-HTTP hosts even when the private HTTP override is enabled", async () => {
    process.env.PRINT_MANAGEMENT_URL = "http://10.0.0.99:9124";
    process.env.PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPrinterDrivers()).rejects.toMatchObject({
      statusCode: 503,
      code: "PRINTER_BRIDGE_MISCONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects arbitrary HTTPS hosts and non-root bridge paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    process.env.PRINT_MANAGEMENT_URL = "https://printer-bridge.internal.example";
    await expect(listPrinterDrivers()).rejects.toMatchObject({ code: "PRINTER_BRIDGE_MISCONFIGURED" });

    process.env.PRINT_MANAGEMENT_URL = "https://prntsp2.sccc.edu:9124/proxy";
    await expect(listPrinterDrivers()).rejects.toMatchObject({ code: "PRINTER_BRIDGE_MISCONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the fixed private bridge host only with the explicit HTTP override", async () => {
    process.env.PRINT_MANAGEMENT_URL = "http://10.0.0.30:9124";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      printServer: PRINT_SERVER,
      drivers: ["SHARP BP-50C26 PCL6"],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPrinterDrivers()).rejects.toMatchObject({
      code: "PRINTER_BRIDGE_MISCONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP = "true";
    await expect(listPrinterDrivers()).resolves.toEqual(["SHARP BP-50C26 PCL6"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://10.0.0.30:9124/v1/printers/drivers",
      expect.any(Object),
    );
  });

  it("sends only validated fields and verifies the bridge result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      created: true,
      printer: {
        name: "West Sharp Copier",
        driver: "SHARP BP-50C26 PCL6",
        portName: "IP_172.25.0.125",
        shareName: "West Sharp Copier",
        uncPath: "\\\\prntsp2.sccc.edu\\West Sharp Copier",
        location: "Truck Driving Office Hallway",
        comment: "",
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(installPrinter({
      name: " West Sharp Copier ",
      ip: "172.25.0.125",
      driver: "SHARP BP-50C26 PCL6",
      location: " Truck Driving Office Hallway ",
      comment: "",
    })).resolves.toMatchObject({ created: true, printer: { portName: "IP_172.25.0.125" } });

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual({
      name: "West Sharp Copier",
      ip: "172.25.0.125",
      driver: "SHARP BP-50C26 PCL6",
      location: "Truck Driving Office Hallway",
      comment: "",
      shareName: "West Sharp Copier",
    });
  });

  it("preserves a bounded phase-specific bridge error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "PRINTER_UNREACHABLE",
        phase: "reachability",
        message: "172.25.0.125 did not accept TCP/9100 within 5 seconds.",
      },
    }), { status: 422, headers: { "Content-Type": "application/json" } })));

    await expect(installPrinter({
      name: "West Sharp Copier",
      ip: "172.25.0.125",
      driver: "SHARP BP-50C26 PCL6",
      location: "",
      comment: "",
    })).rejects.toMatchObject({
      statusCode: 502,
      code: "PRINTER_UNREACHABLE",
      phase: "reachability",
    });
  });

  it("rejects a bridge result whose normalized metadata does not match the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      created: false,
      printer: {
        name: "West Sharp Copier",
        driver: "SHARP BP-50C26 PCL6",
        portName: "IP_172.25.0.125",
        shareName: "West Sharp Copier",
        uncPath: "\\\\prntsp2.sccc.edu\\West Sharp Copier",
        location: "Wrong hallway",
        comment: "",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(installPrinter({
      name: "West Sharp Copier",
      ip: "172.25.0.125",
      driver: "SHARP BP-50C26 PCL6",
      location: "Truck Driving Office Hallway",
      comment: "",
    })).rejects.toMatchObject({
      code: "INVALID_PRINTER_BRIDGE_RESPONSE",
      phase: "verify",
    });
  });
});
