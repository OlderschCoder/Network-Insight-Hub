import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  listPrinterDrivers: vi.fn(),
  installPrinter: vi.fn(),
}));

vi.mock("./auth", () => ({
  requireAuth(req: any, res: any, next: any) {
    if (req.headers.authorization !== "Bearer test") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = { id: 42, role: req.headers["x-test-role"] ?? "helpdesk" };
    next();
  },
  requireNetworkAdmin(req: any, res: any, next: any) {
    if (!["cio", "network", "network_engineer"].includes(req.user?.role)) {
      return res.status(403).json({ error: "Network administrator access required" });
    }
    next();
  },
}));

vi.mock("../lib/printer_management", () => ({
  PRINT_SERVER: "prntsp2.sccc.edu",
  PrinterManagementError: class PrinterManagementError extends Error {},
  isPrinterManagementConfigured: () => true,
  listPrinterDrivers: bridge.listPrinterDrivers,
  installPrinter: bridge.installPrinter,
}));

import printersRouter from "./printers";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use("/api/network/printers", printersRouter);
  return app;
}

describe("printer routes", () => {
  beforeEach(() => {
    bridge.listPrinterDrivers.mockReset();
    bridge.installPrinter.mockReset();
  });

  it("requires both authentication and the network-administrator role", async () => {
    expect((await request(makeApp()).get("/api/network/printers/drivers")).status).toBe(401);
    expect((await request(makeApp())
      .get("/api/network/printers/drivers")
      .set("Authorization", "Bearer test")
      .set("x-test-role", "helpdesk")).status).toBe(403);
  });

  it("returns the live fixed-server driver catalog", async () => {
    bridge.listPrinterDrivers.mockResolvedValue(["SHARP BP-50C26 PCL6"]);
    const response = await request(makeApp())
      .get("/api/network/printers/drivers")
      .set("Authorization", "Bearer test")
      .set("x-test-role", "network");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      configured: true,
      printServer: "prntsp2.sccc.edu",
      drivers: ["SHARP BP-50C26 PCL6"],
    });
  });

  it("runs the validated install through Fred and preserves created status", async () => {
    const body = {
      name: "West Sharp Copier",
      ip: "172.25.0.125",
      driver: "SHARP BP-50C26 PCL6",
      location: "Truck Driving Office Hallway",
      comment: "",
    };
    bridge.installPrinter.mockResolvedValue({
      created: true,
      printer: {
        name: body.name,
        driver: body.driver,
        portName: `IP_${body.ip}`,
        shareName: body.name,
        uncPath: "\\\\prntsp2.sccc.edu\\West Sharp Copier",
        location: body.location,
        comment: body.comment,
      },
    });

    const response = await request(makeApp())
      .post("/api/network/printers")
      .set("Authorization", "Bearer test")
      .set("x-test-role", "network_engineer")
      .send(body);

    expect(response.status).toBe(201);
    expect(bridge.installPrinter).toHaveBeenCalledWith(body);
    expect(response.body).toMatchObject({ created: true, printer: { name: body.name } });
  });
});
