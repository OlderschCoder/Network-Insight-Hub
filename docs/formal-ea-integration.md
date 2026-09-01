# Formal enterprise-architecture document integration

The formal EA layer preserves CIO-approved architecture publications without
turning dated, contradicted, stale, or unknown statements into ordinary Fred
memory. The Markdown file is canonical for machine retrieval. The Word file is
stored as the matching human publication artifact.

## Evidence order

Fred answers architecture questions in this order:

1. Current live evidence from bounded tools.
2. The latest normalized immutable architecture snapshot.
3. The latest approved formal EA publication.
4. Governed team and personal memory.
5. Uploaded files and older evidence.

Fred maintains a single current asset view while preserving historical evidence.
When a live or normalized asset no longer matches the approved baseline, Fred must
report the delta and classify the older record for verification, merge, retirement,
or quarantine. Legacy records are not silently deleted, but they also must not
remain presented as active inventory after retirement is verified. Every status
change requires attributed evidence and a change-log entry.

The formal publication is a dated baseline. When a newer equivalent live source
disagrees, Fred reports the delta and keeps the formal statement as history.

## Immutable records

`formal_ea_documents` registers the title, state/effective dates, source
snapshot, approval, author, classification, hashes, artifacts, importer, and
superseded version. A database trigger rejects update and delete operations.
Replacement documents are inserted with `supersedes_document_id`; the prior
version remains intact.

`formal_ea_sections` preserves heading level, section number, hierarchy,
Markdown content, tables, Mermaid blocks, appendices, order, and content hash.
The full-text index supports bounded section retrieval.

`formal_ea_findings` contains normalized claims, contradictions, quarantine
entries, stale evidence, evidence gaps, risks, single points of failure, and
remediation actions. Each finding links to its exact imported section.

`formal_ea_entity_links` references an entity natural key in the linked source
snapshot. It does not copy the entity, port, VLAN, link, or Azure record into a
second inventory.

## Import operation

The importer is intentionally an administrative deployment operation, not an
arbitrary browser file-path endpoint:

```bash
pnpm --filter @workspace/api-server import:formal-ea -- \
  --markdown /secured/path/SCCC-EA-As-Is-Formal-2026-09-01.md \
  --word /secured/path/SCCC-EA-As-Is-Formal-2026-09-01.docx \
  --imported-by-name "Office of the CIO"
```

The importer:

- hashes both artifacts and refuses a duplicate Markdown hash;
- parses Document Control metadata;
- links only to a snapshot generated within five minutes of the documented
  source timestamp;
- copies both files to `FORMAL_EA_DIR` or `data/formal-ea`;
- imports sections and findings in one database transaction;
- creates entity references using the linked snapshot's existing normalized
  keys;
- never writes imported narrative into AI memory.

Use `GET /api/status-report/enterprise-architecture/formal/latest` to verify the
registered document, source snapshot, hashes, and record counts. Fred uses the
bounded `query_formal_architecture` tool for metadata, section, full-text, and
finding queries.

## Boundaries

- Import does not modify a live device or upstream source system.
- Import does not rewrite the linked immutable JSON snapshot.
- Import does not promote every sentence to known-good state.
- Approval in the source Document Control table governs whether the document is
  eligible as Fred's latest approved baseline.
- The database stores server-side artifact paths but never returns them through
  Fred's query tool or the metadata endpoint.
- A formal report can describe unknown or contradicted state. Its confidence and
  source context must travel with the retrieved content.
