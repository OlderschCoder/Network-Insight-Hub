import { readFile } from "node:fs/promises";
import path from "node:path";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";

const router: IRouter = Router();

const contentDirectory = process.env.IT_HUB_BANNER_CONTENT_DIR
  || path.resolve(process.cwd(), "artifacts/it-reporting/src/content/banner");

const documents = {
  report: "corrected-report.md",
  procedure: "operating-procedure.md",
  changes: "change-log.md",
} as const;

const architectureFiles = {
  content: "system-architecture-access.md",
  diagrams: "system-architecture-access.diagrams.json",
} as const;

const diagramSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  height: z.number().int().min(320).max(1_200),
  nodes: z.array(z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(160),
    subtitle: z.string().max(300).optional(),
    kind: z.enum(["source", "process", "identity", "store", "control", "external", "interface"]),
    x: z.number().finite().min(-10_000).max(10_000),
    y: z.number().finite().min(-10_000).max(10_000),
  })).min(1).max(60),
  edges: z.array(z.object({
    id: z.string().min(1).max(80),
    source: z.string().min(1).max(80),
    target: z.string().min(1).max(80),
    label: z.string().max(160).optional(),
  })).max(120),
}).superRefine((diagram, context) => {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const node of diagram.nodes) {
    if (nodeIds.has(node.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate node ID: ${node.id}` });
    }
    nodeIds.add(node.id);
  }
  for (const edge of diagram.edges) {
    if (edgeIds.has(edge.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate edge ID: ${edge.id}` });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Edge ${edge.id} references an unknown node` });
    }
  }
});

const architectureSchema = z.object({
  diagrams: z.array(diagramSchema).min(1).max(10),
});

router.get("/documents", requireAuth, async (req: any, res) => {
  try {
    const entries = await Promise.all(
      Object.entries(documents).map(async ([key, fileName]) => {
        const content = await readFile(path.join(contentDirectory, fileName), "utf8");
        return [key, content] as const;
      }),
    );

    const [architectureContent, architectureDiagramJson] = await Promise.all([
      readFile(path.join(contentDirectory, architectureFiles.content), "utf8"),
      readFile(path.join(contentDirectory, architectureFiles.diagrams), "utf8"),
    ]);
    const architectureDiagrams = architectureSchema.parse(JSON.parse(architectureDiagramJson));

    res.set({
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    });
    return res.json({
      ...Object.fromEntries(entries),
      architecture: {
        content: architectureContent,
        diagrams: architectureDiagrams.diagrams,
      },
    });
  } catch (error) {
    req.log?.error({ error }, "Unable to read protected Banner documents");
    return res.status(503).json({ error: "Banner documentation is temporarily unavailable" });
  }
});

export default router;
