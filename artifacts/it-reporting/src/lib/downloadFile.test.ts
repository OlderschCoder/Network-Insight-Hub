import { describe, expect, it } from "vitest";
import { filenameFromContentDisposition } from "./downloadFile";

describe("filenameFromContentDisposition", () => {
  it("reads quoted and UTF-8 filenames", () => {
    expect(filenameFromContentDisposition('attachment; filename="risk-register-open.pdf"')).toBe("risk-register-open.pdf");
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''Post-Incident%20Review.docx")).toBe("Post-Incident Review.docx");
  });

  it("drops path components and handles missing headers", () => {
    expect(filenameFromContentDisposition('attachment; filename="../unsafe/report.pdf"')).toBe("report.pdf");
    expect(filenameFromContentDisposition(null)).toBeNull();
  });
});
