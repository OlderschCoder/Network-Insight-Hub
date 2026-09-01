import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type FormalEaSection = {
  ordinal: number;
  level: number;
  sectionNumber: string | null;
  heading: string;
  headingPath: string[];
  content: string;
  contentSha256: string;
};

export type FormalEaFinding = {
  sectionOrdinal: number;
  findingType: string;
  confidence: string | null;
  priority: string | null;
  title: string;
  content: string;
  sourceReference: string;
  attributes: Record<string, unknown>;
};

export type FormalEaMetadata = {
  title: string;
  version: string;
  architectureStateDate: string;
  snapshotGeneratedAt: string | null;
  approvalStatus: string;
  documentStatus: string;
  author: string;
  approvedBy: string | null;
  classification: string;
};

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const clean = (value: string) =>
  value.replace(/\*\*/g, "").replace(/`/g, "").trim();

function documentControl(markdown: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of markdown.split(/\r?\n/).slice(0, 80)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (
      !match ||
      /^[-: ]+$/.test(match[1]) ||
      clean(match[1]).toLowerCase() === "field"
    )
      continue;
    result[clean(match[1]).toLowerCase()] = clean(match[2]);
  }
  return result;
}

export function parseFormalEaMarkdown(markdown: string): {
  metadata: FormalEaMetadata;
  sections: FormalEaSection[];
  findings: FormalEaFinding[];
} {
  const control = documentControl(markdown);
  const topTitles = markdown
    .split(/\r?\n/)
    .filter((line) => /^#\s+/.test(line))
    .slice(0, 2)
    .map((line) => clean(line.replace(/^#\s+/, "")));
  const title =
    control["document title"] ||
    topTitles.join(" — ") ||
    "Formal enterprise architecture";
  const stateDate =
    control["architecture state date"] || new Date().toISOString().slice(0, 10);
  const snapshotRaw = control["evidence snapshot generated"] || "";
  const snapshotGeneratedAt = snapshotRaw
    ? new Date(snapshotRaw.replace(" UTC", "Z")).toISOString()
    : null;
  const documentStatus = control["document status"] || "Formal issue";
  const approvalStatus = /formal|approved/i.test(documentStatus)
    ? "approved"
    : "draft";
  const metadata: FormalEaMetadata = {
    title,
    version: stateDate,
    architectureStateDate: stateDate,
    snapshotGeneratedAt,
    approvalStatus,
    documentStatus,
    author: control["prepared by"] || "Office of the CIO",
    approvedBy: control["approval authority"] || null,
    classification:
      control["classification"] || "AS-IS, evidence-based architecture",
  };

  const lines = markdown.split(/\r?\n/);
  const rawSections: Array<{
    level: number;
    heading: string;
    start: number;
    path: string[];
  }> = [];
  const stack: string[] = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (!match) return;
    const level = match[1].length;
    const heading = clean(match[2]);
    stack.splice(level - 1);
    stack[level - 1] = heading;
    rawSections.push({
      level,
      heading,
      start: index + 1,
      path: stack.filter(Boolean),
    });
  });
  const sections = rawSections.map((row, index): FormalEaSection => {
    const end = rawSections[index + 1]?.start
      ? rawSections[index + 1].start - 1
      : lines.length;
    const content = lines.slice(row.start, end).join("\n").trim();
    const numberMatch = row.heading.match(
      /^(?:Section\s+)?(\d+(?:\.\d+)*)\.?\s+/i,
    );
    return {
      ordinal: index + 1,
      level: row.level,
      sectionNumber: numberMatch?.[1] ?? null,
      heading: row.heading,
      headingPath: row.path,
      content,
      contentSha256: sha256(content),
    };
  });

  const findings: FormalEaFinding[] = [];
  const seen = new Set<string>();
  const addFinding = (
    section: FormalEaSection,
    findingType: string,
    text: string,
    confidence: string | null = null,
    priority: string | null = null,
  ) => {
    const content = clean(text)
      .replace(/^\|\s*/, "")
      .replace(/\s*\|$/, "")
      .trim();
    if (
      !content ||
      /^[-|: ]+$/.test(content) ||
      /^(#|field\s*\|)/i.test(content)
    )
      return;
    const key = sha256(`${section.ordinal}\n${findingType}\n${content}`);
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      sectionOrdinal: section.ordinal,
      findingType,
      confidence,
      priority,
      title: content.slice(0, 997),
      content,
      sourceReference: section.sectionNumber
        ? `Section ${section.sectionNumber}`
        : section.heading,
      attributes: { headingPath: section.headingPath },
    });
  };
  for (const section of sections) {
    const heading = section.heading.toLowerCase();
    let structuralType: string | null = null;
    if (heading.includes("quarantine register")) structuralType = "quarantine";
    else if (heading.includes("risk register")) structuralType = "risk";
    else if (heading.includes("single points of failure"))
      structuralType = "single_point_of_failure";
    else if (heading.includes("missing evidence"))
      structuralType = "evidence_gap";
    else if (heading.includes("stale evidence"))
      structuralType = "stale_evidence";
    else if (heading.includes("remediation") || /^phase\s+\d/i.test(heading))
      structuralType = "remediation";
    const paragraphs = section.content
      .split(/\n\s*\n|(?=^\|)/m)
      .map((value) => value.trim())
      .filter(Boolean);
    for (const paragraph of paragraphs) {
      const label =
        paragraph
          .match(
            /\*\*\[(VERIFIED|COMPUTED|INFERRED|STALE|CONTRADICTED|UNKNOWN)(?:[^\]]*)\]\*\*/i,
          )?.[1]
          ?.toLowerCase() ?? null;
      if (label)
        addFinding(
          section,
          label === "stale"
            ? "stale_evidence"
            : label === "contradicted"
              ? "contradiction"
              : "evidence_claim",
          paragraph,
          label,
        );
      if (
        structuralType &&
        (/^(?:[-*]|\d+\.|\|)/.test(paragraph) || paragraph.length < 2500)
      ) {
        const priority =
          paragraph
            .match(/\b(P[0-3]|critical|high|medium|low)\b/i)?.[1]
            ?.toLowerCase() ?? null;
        addFinding(section, structuralType, paragraph, label, priority);
      }
    }
  }
  return { metadata, sections, findings };
}

export async function importFormalEaDocument(input: {
  markdownPath: string;
  wordPath?: string | null;
  importedBy?: number | null;
  importedByName?: string | null;
  storageDir?: string;
}): Promise<Record<string, unknown>> {
  const markdownBuffer = await readFile(input.markdownPath);
  const wordBuffer = input.wordPath ? await readFile(input.wordPath) : null;
  const markdown = markdownBuffer.toString("utf8");
  const parsed = parseFormalEaMarkdown(markdown);
  const contentSha256 = sha256(markdownBuffer);
  const wordSha256 = wordBuffer ? sha256(wordBuffer) : null;
  const existing: any = await db.execute(
    sql`SELECT id, title, version, created_at AS "createdAt" FROM formal_ea_documents WHERE content_sha256 = ${contentSha256}`,
  );
  if (existing.rows?.[0])
    return {
      imported: false,
      reason: "identical_content_exists",
      document: existing.rows[0],
    };

  const storageDir = path.resolve(
    input.storageDir || process.env.FORMAL_EA_DIR || "data/formal-ea",
  );
  await mkdir(storageDir, { recursive: true });
  const markdownName = path.basename(input.markdownPath);
  const wordName = input.wordPath ? path.basename(input.wordPath) : null;
  const storedMarkdown = path.join(
    storageDir,
    `${contentSha256.slice(0, 12)}-${markdownName}`,
  );
  const storedWord = wordName
    ? path.join(storageDir, `${contentSha256.slice(0, 12)}-${wordName}`)
    : null;
  await copyFile(input.markdownPath, storedMarkdown);
  if (input.wordPath && storedWord) await copyFile(input.wordPath, storedWord);

  const snapshotResult: any = parsed.metadata.snapshotGeneratedAt
    ? await db.execute(sql`
    SELECT id, generated_at AS "generatedAt" FROM fred_architecture_snapshots
    WHERE generated_at BETWEEN ${parsed.metadata.snapshotGeneratedAt}::timestamptz - interval '5 minutes'
      AND ${parsed.metadata.snapshotGeneratedAt}::timestamptz + interval '5 minutes'
    ORDER BY abs(extract(epoch FROM (generated_at - ${parsed.metadata.snapshotGeneratedAt}::timestamptz))) LIMIT 1
  `)
    : { rows: [] };
  const snapshot = snapshotResult.rows?.[0] ?? null;
  const previousResult: any = await db.execute(
    sql`SELECT id FROM formal_ea_documents WHERE title = ${parsed.metadata.title} ORDER BY effective_at DESC, id DESC LIMIT 1`,
  );
  const previousId = previousResult.rows?.[0]?.id ?? null;

  const result = await db.transaction(async (tx) => {
    const docResult: any = await tx.execute(sql`
      INSERT INTO formal_ea_documents (title, version, architecture_state_date, effective_at, source_snapshot_id, source_snapshot_generated_at,
        approval_status, document_status, author, approved_by, approved_at, classification, content_sha256,
        markdown_filename, markdown_storage_path, word_filename, word_storage_path, word_sha256, supersedes_document_id, imported_by, imported_by_name)
      VALUES (${parsed.metadata.title}, ${parsed.metadata.version}, ${parsed.metadata.architectureStateDate}::date,
        ${parsed.metadata.architectureStateDate}::date::timestamptz, ${snapshot?.id ?? null}, ${parsed.metadata.snapshotGeneratedAt}::timestamptz,
        ${parsed.metadata.approvalStatus}, ${parsed.metadata.documentStatus}, ${parsed.metadata.author}, ${parsed.metadata.approvedBy},
        ${parsed.metadata.approvalStatus === "approved" ? parsed.metadata.architectureStateDate : null}::date::timestamptz,
        ${parsed.metadata.classification}, ${contentSha256}, ${markdownName}, ${storedMarkdown}, ${wordName}, ${storedWord}, ${wordSha256}, ${previousId},
        ${input.importedBy ?? null}, ${input.importedByName ?? null}) RETURNING id
    `);
    const documentId = Number(docResult.rows[0].id);
    const sectionRows: Array<{ id: number; ordinal: number }> = [];
    for (const section of parsed.sections) {
      const inserted: any = await tx.execute(sql`INSERT INTO formal_ea_sections
        (document_id, ordinal, level, section_number, heading, heading_path, content, content_sha256)
        VALUES (${documentId}, ${section.ordinal}, ${section.level}, ${section.sectionNumber}, ${section.heading},
          ${JSON.stringify(section.headingPath)}::jsonb, ${section.content}, ${section.contentSha256}) RETURNING id`);
      sectionRows.push({
        id: Number(inserted.rows[0].id),
        ordinal: section.ordinal,
      });
    }
    const sectionIds = new Map(sectionRows.map((row) => [row.ordinal, row.id]));
    for (const finding of parsed.findings)
      await tx.execute(sql`INSERT INTO formal_ea_findings
      (document_id, section_id, finding_type, confidence, priority, title, content, source_reference, attributes)
      VALUES (${documentId}, ${sectionIds.get(finding.sectionOrdinal)}, ${finding.findingType}, ${finding.confidence}, ${finding.priority},
        ${finding.title}, ${finding.content}, ${finding.sourceReference}, ${JSON.stringify(finding.attributes)}::jsonb)`);

    let linkCount = 0;
    if (snapshot?.id) {
      const entityResult: any = await tx.execute(
        sql`SELECT entity_type AS "entityType", natural_key AS "naturalKey", name FROM fred_architecture_entities WHERE snapshot_id = ${snapshot.id}`,
      );
      for (const section of parsed.sections) {
        const haystack = `${section.heading}\n${section.content}`.toLowerCase();
        const sectionId = sectionIds.get(section.ordinal)!;
        let sectionLinks = 0;
        for (const entity of entityResult.rows ?? []) {
          const candidates = [
            String(entity.naturalKey || ""),
            String(entity.name || ""),
          ].filter((value) => value.length >= 5);
          if (
            !candidates.some((candidate) =>
              haystack.includes(candidate.toLowerCase()),
            )
          )
            continue;
          await tx.execute(sql`INSERT INTO formal_ea_entity_links (document_id, section_id, snapshot_id, entity_type, natural_key, link_type)
            VALUES (${documentId}, ${sectionId}, ${snapshot.id}, ${entity.entityType}, ${entity.naturalKey}, 'mentions') ON CONFLICT DO NOTHING`);
          linkCount++;
          sectionLinks++;
          if (sectionLinks >= 250) break;
        }
      }
    }
    return {
      documentId,
      sectionCount: parsed.sections.length,
      findingCount: parsed.findings.length,
      entityLinkCount: linkCount,
    };
  });
  return {
    imported: true,
    ...result,
    metadata: parsed.metadata,
    contentSha256,
    snapshotId: snapshot?.id ?? null,
    snapshotGeneratedAt: snapshot?.generatedAt ?? null,
    storedMarkdown,
    storedWord,
  };
}
