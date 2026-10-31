import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";

describe("formal EA Markdown parser", () => {
  const markdown = `# SCCC\n# Enterprise Architecture — Current State (As-Is)\n\n## Section 1. Document Control\n| Field | Value |\n|---|---|\n| Document title | SCCC Enterprise Architecture — Current State (As-Is) |\n| Architecture state date | 2026-09-01 |\n| Evidence snapshot generated | 2026-09-01 02:13:32 UTC |\n| Document status | Formal issue |\n| Prepared by | Office of the CIO |\n| Approval authority | Chief Information Officer |\n\n## Section 9. Risks\n### 9.1 Risk register\n| 1 | Appserver concentration | High | **[VERIFIED]** |\n\n### 9.2 Quarantine Register\n- Duplicate address remains unresolved. **[CONTRADICTED]**\n\n## Section 10. Evidence Gaps and Prioritized Validation/Remediation Plan\n### 10.1 Missing evidence domains\n- Current restore results are absent. **[UNKNOWN]**\n`;

  it("preserves metadata, hierarchy, and immutable section hashes", async () => {
    const { parseFormalEaMarkdown } = await import("./formal_ea");
    const parsed = parseFormalEaMarkdown(markdown);
    expect(parsed.metadata).toMatchObject({
      architectureStateDate: "2026-09-01",
      approvalStatus: "approved",
      approvedBy: "Chief Information Officer",
    });
    expect(parsed.metadata.snapshotGeneratedAt).toBe(
      "2026-09-01T02:13:32.000Z",
    );
    expect(
      parsed.sections.find((row) => row.sectionNumber === "9.2")?.headingPath,
    ).toEqual(
      expect.arrayContaining(["Section 9. Risks", "9.2 Quarantine Register"]),
    );
    expect(
      parsed.sections.every((row) => /^[a-f0-9]{64}$/.test(row.contentSha256)),
    ).toBe(true);
  });

  it("normalizes risks, quarantines, contradictions, and evidence gaps without treating them as memory", async () => {
    const { parseFormalEaMarkdown } = await import("./formal_ea");
    const findings = parseFormalEaMarkdown(markdown).findings;
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ findingType: "risk", priority: "high" }),
        expect.objectContaining({ findingType: "quarantine" }),
        expect.objectContaining({
          findingType: "contradiction",
          confidence: "contradicted",
        }),
        expect.objectContaining({
          findingType: "evidence_gap",
          confidence: "unknown",
        }),
      ]),
    );
  });
});
