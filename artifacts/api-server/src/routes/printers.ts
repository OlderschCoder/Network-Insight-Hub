import { Router } from "express";
import { requireAuth, requireNetworkAdmin } from "./auth";
import {
  PRINT_SERVER,
  PrinterManagementError,
  installPrinter,
  isPrinterManagementConfigured,
  listPrinterDrivers,
} from "../lib/printer_management";

const router = Router();

function sendPrinterManagementError(res: any, error: unknown) {
  if (error instanceof PrinterManagementError) {
    return res.status(error.statusCode).json({
      configured: error.statusCode === 503 ? isPrinterManagementConfigured() : true,
      printServer: PRINT_SERVER,
      error: {
        code: error.code,
        message: error.message,
        ...(error.phase ? { phase: error.phase } : {}),
      },
    });
  }
  return res.status(500).json({
    configured: isPrinterManagementConfigured(),
    printServer: PRINT_SERVER,
    error: {
      code: "PRINTER_MANAGEMENT_ERROR",
      message: "Printer management failed unexpectedly.",
    },
  });
}

/** GET /api/network/printers/drivers – exact drivers registered on PRNTSP2. */
router.get("/drivers", requireAuth, requireNetworkAdmin, async (_req, res) => {
  try {
    const drivers = await listPrinterDrivers();
    return res.json({ configured: true, printServer: PRINT_SERVER, drivers });
  } catch (error) {
    return sendPrinterManagementError(res, error);
  }
});

/** POST /api/network/printers – idempotently create/update a shared RAW TCP/9100 queue. */
router.post("/", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  try {
    const result = await installPrinter(req.body);
    req.log?.info?.(
      {
        userId: req.user?.id,
        printerName: result.printer.name,
        printerIp: result.printer.portName.replace(/^IP_/, ""),
        printServer: PRINT_SERVER,
        created: result.created,
      },
      "Printer queue configured through Fred",
    );
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    req.log?.warn?.(
      {
        userId: req.user?.id,
        printerName: typeof req.body?.name === "string" ? req.body.name.slice(0, 120) : undefined,
        errorCode: error instanceof PrinterManagementError ? error.code : "PRINTER_MANAGEMENT_ERROR",
        phase: error instanceof PrinterManagementError ? error.phase : undefined,
      },
      "Printer queue configuration failed",
    );
    return sendPrinterManagementError(res, error);
  }
});

export default router;
