import express, { Router } from "express";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import {
  buildFredFileReviewContext,
  deleteFredFile,
  getFredFile,
  getFredFilePreview,
  listFredFiles,
  storeFredFileFromTemp,
} from "../lib/fred_files";

const router = Router();

function canDeleteRecord(req: any, record: { uploadedBy: number | null }) {
  const role = req.user?.role ?? "";
  return role === "cio" || (record.uploadedBy != null && req.user?.id === record.uploadedBy);
}

router.get("/", requireAuth, async (_req: any, res) => {
  try {
    const files = await listFredFiles();
    return res.json(files);
  } catch (error) {
    logger.error({ err: error }, "Failed to list Fred files");
    return res.status(500).json({ error: "Failed to load Fred files" });
  }
});

router.post("/", requireAuth, async (req: any, res) => {
  try {
    const { formidable } = await import("formidable");
    const form = formidable({
      multiples: true,
      keepExtensions: true,
      allowEmptyFiles: false,
      maxFiles: 20,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalFileSize: 500 * 1024 * 1024,
    });

    const [fields, uploaded] = await form.parse(req);
    const rawFiles = uploaded.files;
    const fileList = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
    if (fileList.length === 0) {
      return res.status(400).json({ error: "At least one file is required" });
    }

    const saved = [];
    for (const file of fileList) {
      if (!file || !file.originalFilename || !file.filepath) continue;
      const row = await storeFredFileFromTemp({
        tempPath: file.filepath,
        originalName: file.originalFilename,
        mimeType: file.mimetype,
        sizeBytes: typeof file.size === "number" ? file.size : 0,
        uploadedBy: req.user?.id ?? null,
        uploadedByName: req.user?.name ?? req.user?.email ?? null,
      });
      saved.push(row);
    }

    logger.info({ count: saved.length, userId: req.user?.id ?? null }, "Fred files uploaded");
    return res.json({
      uploaded: saved,
      notes: fields.notes ?? null,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Failed to upload Fred files");
    const message = typeof error?.message === "string" ? error.message : "Failed to upload files";
    const status = /max/i.test(message) || /too large/i.test(message) ? 413 : 500;
    return res.status(status).json({ error: message });
  }
});

router.get("/:id", requireAuth, async (req: any, res) => {
  try {
    const preview = await getFredFilePreview(req.params.id);
    if (!preview) return res.status(404).json({ error: "File not found" });
    return res.json(preview);
  } catch (error) {
    logger.error({ err: error, id: req.params.id }, "Failed to read Fred file preview");
    return res.status(500).json({ error: "Failed to load file preview" });
  }
});

router.get("/:id/download", requireAuth, async (req: any, res) => {
  try {
    const record = await getFredFile(req.params.id);
    if (!record) return res.status(404).json({ error: "File not found" });
    const pathModule = await import("node:path");
    const fsModule = await import("node:fs");
    const rootDir = pathModule.resolve(process.cwd(), process.env.FRED_UPLOAD_DIR ?? "data/fred-files", "files");
    const fullPath = pathModule.join(rootDir, record.storedName);
    if (!fsModule.existsSync(fullPath)) {
      return res.status(404).json({ error: "Stored file missing" });
    }
    res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
    return res.download(fullPath, record.originalName);
  } catch (error) {
    logger.error({ err: error, id: req.params.id }, "Failed to download Fred file");
    return res.status(500).json({ error: "Failed to download file" });
  }
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  try {
    const record = await getFredFile(req.params.id);
    if (!record) return res.status(404).json({ error: "File not found" });
    if (!canDeleteRecord(req, record)) {
      return res.status(403).json({ error: "Only the uploader or CIO can delete this file" });
    }
    await deleteFredFile(req.params.id);
    return res.json({ deleted: true });
  } catch (error) {
    logger.error({ err: error, id: req.params.id }, "Failed to delete Fred file");
    return res.status(500).json({ error: "Failed to delete file" });
  }
});

router.post(
  "/review-context",
  requireAuth,
  express.json({ limit: "2mb" }),
  async (req: any, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((value: unknown) => typeof value === "string") : [];
      const context = await buildFredFileReviewContext(ids, 60000);
      return res.json({ context });
    } catch (error) {
      logger.error({ err: error }, "Failed to build Fred file review context");
      return res.status(500).json({ error: "Failed to build review context" });
    }
  },
);

export default router;
