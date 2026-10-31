import {
  pgTable,
  bigserial,
  bigint,
  integer,
  varchar,
  text,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const formalEaDocumentsTable = pgTable(
  "formal_ea_documents",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    title: varchar("title", { length: 500 }).notNull(),
    version: varchar("version", { length: 100 }).notNull(),
    architectureStateDate: date("architecture_state_date").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    sourceSnapshotId: bigint("source_snapshot_id", { mode: "number" }),
    sourceSnapshotGeneratedAt: timestamp("source_snapshot_generated_at", {
      withTimezone: true,
    }),
    approvalStatus: varchar("approval_status", { length: 40 }).notNull(),
    documentStatus: varchar("document_status", { length: 100 }).notNull(),
    author: varchar("author", { length: 255 }).notNull(),
    approvedBy: varchar("approved_by", { length: 255 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    classification: varchar("classification", { length: 255 }).notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    markdownFilename: varchar("markdown_filename", { length: 500 }).notNull(),
    markdownStoragePath: text("markdown_storage_path").notNull(),
    wordFilename: varchar("word_filename", { length: 500 }),
    wordStoragePath: text("word_storage_path"),
    wordSha256: varchar("word_sha256", { length: 64 }),
    supersedesDocumentId: bigint("supersedes_document_id", { mode: "number" }),
    importedBy: integer("imported_by"),
    importedByName: varchar("imported_by_name", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    contentHashUnique: uniqueIndex("formal_ea_documents_hash_unique").on(
      table.contentSha256,
    ),
  }),
);

export const formalEaSectionsTable = pgTable("formal_ea_sections", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  documentId: bigint("document_id", { mode: "number" }).notNull(),
  ordinal: integer("ordinal").notNull(),
  level: integer("level").notNull(),
  sectionNumber: varchar("section_number", { length: 100 }),
  heading: varchar("heading", { length: 1000 }).notNull(),
  headingPath: jsonb("heading_path").$type<string[]>().default([]).notNull(),
  content: text("content").notNull(),
  contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
});

export const formalEaFindingsTable = pgTable("formal_ea_findings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  documentId: bigint("document_id", { mode: "number" }).notNull(),
  sectionId: bigint("section_id", { mode: "number" }).notNull(),
  findingType: varchar("finding_type", { length: 80 }).notNull(),
  confidence: varchar("confidence", { length: 40 }),
  priority: varchar("priority", { length: 40 }),
  title: varchar("title", { length: 1000 }).notNull(),
  content: text("content").notNull(),
  sourceReference: varchar("source_reference", { length: 500 }).notNull(),
  attributes: jsonb("attributes")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
});

export const formalEaEntityLinksTable = pgTable(
  "formal_ea_entity_links",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "number" }).notNull(),
    sectionId: bigint("section_id", { mode: "number" }).notNull(),
    snapshotId: bigint("snapshot_id", { mode: "number" }).notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    naturalKey: varchar("natural_key", { length: 500 }).notNull(),
    linkType: varchar("link_type", { length: 40 })
      .notNull()
      .default("mentions"),
  },
  (table) => ({
    linkUnique: uniqueIndex("formal_ea_entity_links_unique").on(
      table.documentId,
      table.sectionId,
      table.snapshotId,
      table.entityType,
      table.naturalKey,
      table.linkType,
    ),
  }),
);
