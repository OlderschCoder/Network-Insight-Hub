import type { Response } from "express";

export type PdfSection =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string; bold?: boolean; italic?: boolean }
  | { kind: "kv"; label: string; value: string }
  | { kind: "bullet"; text: string }
  | { kind: "spacer" };

export interface PdfDocOptions {
  title: string;
  subtitle?: string;
  filename: string;
  sections: PdfSection[];
}

export async function streamPdf(res: Response, opts: PdfDocOptions) {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    bufferPages: true,
    info: { Title: opts.title, Producer: "SCCC IT Hub" },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${opts.filename}"`
  );
  doc.pipe(res);

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text(opts.title, { align: "left" });
  if (opts.subtitle) {
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(11).fillColor("#475569").text(opts.subtitle);
  }
  doc.moveDown(0.5);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#cbd5e1")
    .lineWidth(0.75)
    .stroke();
  doc.moveDown(0.6);

  for (const s of opts.sections) {
    switch (s.kind) {
      case "heading": {
        const sizes = { 1: 16, 2: 13, 3: 12 } as const;
        doc.moveDown(0.4);
        doc
          .font("Helvetica-Bold")
          .fontSize(sizes[s.level])
          .fillColor("#0f172a")
          .text(s.text);
        doc.moveDown(0.2);
        break;
      }
      case "paragraph": {
        const font =
          s.bold && s.italic
            ? "Helvetica-BoldOblique"
            : s.bold
            ? "Helvetica-Bold"
            : s.italic
            ? "Helvetica-Oblique"
            : "Helvetica";
        doc.font(font).fontSize(11).fillColor("#1f2937").text(s.text || " ", { align: "left" });
        doc.moveDown(0.3);
        break;
      }
      case "kv": {
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#475569").text(`${s.label}: `, { continued: true });
        doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(s.value || "—");
        break;
      }
      case "bullet": {
        doc.font("Helvetica").fontSize(11).fillColor("#1f2937").text(`•  ${s.text}`, {
          indent: 12,
        });
        break;
      }
      case "spacer":
        doc.moveDown(0.6);
        break;
    }
  }

  // Footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.height - 40;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#94a3b8")
      .text(
        `${opts.title}  ·  Page ${i + 1} of ${range.count}  ·  Generated ${new Date().toLocaleString()}`,
        doc.page.margins.left,
        bottom,
        { align: "center", width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
      );
  }

  doc.end();
}
