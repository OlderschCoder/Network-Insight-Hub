import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type FredFileReviewKind = "text" | "image" | "binary";

export interface FredFileRecord {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  reviewKind: FredFileReviewKind;
  uploadedBy: number | null;
  uploadedByName: string | null;
  createdAt: string;
}

const DEFAULT_UPLOAD_ROOT = path.resolve(process.cwd(), process.env.FRED_UPLOAD_DIR ?? "data/fred-files");
const FILES_DIR = path.join(DEFAULT_UPLOAD_ROOT, "files");
const INDEX_PATH = path.join(DEFAULT_UPLOAD_ROOT, "index.json");

function normalizeName(input: string) {
  const cleaned = input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "file";
}

function isTextLike(mimeType: string, filename: string) {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = filename.toLowerCase();
  if (
    lowerMime.startsWith("text/") ||
    lowerMime.includes("json") ||
    lowerMime.includes("xml") ||
    lowerMime.includes("yaml") ||
    lowerMime.includes("csv")
  ) {
    return true;
  }
  return [
    ".txt",
    ".log",
    ".cfg",
    ".conf",
    ".ini",
    ".json",
    ".csv",
    ".xml",
    ".yml",
    ".yaml",
    ".md",
    ".ps1",
    ".sh",
    ".py",
    ".js",
    ".ts",
    ".sql",
    ".env",
  ].some((ext) => lowerName.endsWith(ext));
}

function classifyReviewKind(mimeType: string, filename: string): FredFileReviewKind {
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith("image/")) return "image";
  if (isTextLike(mimeType, filename)) return "text";
  return "binary";
}

export async function ensureFredFileStore() {
  await fs.mkdir(FILES_DIR, { recursive: true });
}

async function readIndex() {
  await ensureFredFileStore();
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FredFileRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(records: FredFileRecord[]) {
  await ensureFredFileStore();
  await fs.writeFile(INDEX_PATH, JSON.stringify(records, null, 2), "utf8");
}

export async function listFredFiles() {
  const records = await readIndex();
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getFredFile(id: string) {
  const records = await readIndex();
  return records.find((record) => record.id === id) ?? null;
}

export async function storeFredFileFromTemp(opts: {
  tempPath: string;
  originalName: string;
  mimeType?: string | null;
  sizeBytes: number;
  uploadedBy: number | null;
  uploadedByName: string | null;
}) {
  await ensureFredFileStore();
  const id = randomUUID();
  const safeName = normalizeName(opts.originalName);
  const storedName = `${id}-${safeName}`;
  const destination = path.join(FILES_DIR, storedName);

  try {
    await fs.rename(opts.tempPath, destination);
  } catch {
    await fs.copyFile(opts.tempPath, destination);
    await fs.unlink(opts.tempPath).catch(() => undefined);
  }

  const record: FredFileRecord = {
    id,
    originalName: opts.originalName,
    storedName,
    mimeType: opts.mimeType?.trim() || "application/octet-stream",
    sizeBytes: opts.sizeBytes,
    reviewKind: classifyReviewKind(opts.mimeType?.trim() || "", opts.originalName),
    uploadedBy: opts.uploadedBy,
    uploadedByName: opts.uploadedByName,
    createdAt: new Date().toISOString(),
  };

  const records = await readIndex();
  records.push(record);
  await writeIndex(records);
  return record;
}

export async function deleteFredFile(id: string) {
  const records = await readIndex();
  const record = records.find((entry) => entry.id === id) ?? null;
  if (!record) return null;
  const next = records.filter((entry) => entry.id !== id);
  await writeIndex(next);
  await fs.unlink(path.join(FILES_DIR, record.storedName)).catch(() => undefined);
  return record;
}

async function readTextExcerpt(filePath: string, maxChars: number) {
  const buffer = await fs.readFile(filePath);
  const text = buffer.toString("utf8");
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const headChars = Math.max(800, Math.floor(maxChars * 0.65));
  const tailChars = Math.max(400, maxChars - headChars);
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  return {
    text: `${head}\n\n...[truncated middle]...\n\n${tail}`,
    truncated: true,
  };
}

export async function getFredFilePreview(id: string, maxChars = 12000) {
  const record = await getFredFile(id);
  if (!record) return null;
  if (record.reviewKind !== "text") {
    return {
      record,
      previewText: null,
      truncated: false,
    };
  }
  const filePath = path.join(FILES_DIR, record.storedName);
  const excerpt = await readTextExcerpt(filePath, maxChars);
  return {
    record,
    previewText: excerpt.text,
    truncated: excerpt.truncated,
  };
}

export async function buildFredFileReviewContext(ids: string[], maxChars = 60000) {
  if (!Array.isArray(ids) || ids.length === 0) return "";
  const seen = new Set<string>();
  const selected: FredFileRecord[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    const record = await getFredFile(id);
    if (record) selected.push(record);
  }
  if (selected.length === 0) return "";

  let remaining = maxChars;
  const parts: string[] = [
    "## User-selected uploaded files",
    "Use these as primary evidence for this request when relevant.",
    "If an excerpt is truncated, say so plainly instead of pretending you saw the full file.",
    "",
  ];

  for (const record of selected) {
    const header = `### ${record.originalName}\n- MIME: ${record.mimeType}\n- Size: ${record.sizeBytes} bytes\n- Uploaded: ${record.createdAt}\n- Review kind: ${record.reviewKind}\n`;
    parts.push(header);
    remaining -= header.length;
    if (remaining <= 0) break;

    if (record.reviewKind === "text") {
      const excerpt = await readTextExcerpt(path.join(FILES_DIR, record.storedName), Math.min(18000, remaining));
      const block = `\`\`\`\n${excerpt.text}\n\`\`\`\n${excerpt.truncated ? "_Excerpt truncated from a larger file._\n" : ""}`;
      parts.push(block);
      remaining -= block.length;
      if (remaining <= 0) break;
    } else if (record.reviewKind === "image") {
      const note = "_Image file uploaded. Fred can reference that it exists, but this stored-file path is not yet passed as a vision attachment automatically._\n";
      parts.push(note);
      remaining -= note.length;
    } else {
      const note = "_Binary file uploaded. Metadata is available, but full text extraction is not available for this file type yet._\n";
      parts.push(note);
      remaining -= note.length;
    }
  }

  return parts.join("\n").trim();
}
