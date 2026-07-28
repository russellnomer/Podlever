/**
 * lib/pdf/transcript.ts — Episode transcript PDF generator
 *
 * Part of: PodLever
 * Created: 2026-07-28
 * Last modified: 2026-07-28 (fix: users expected a PDF export; only txt/md existed)
 *
 * Generates a clean, branded PDF of the episode transcript using pdfkit
 * (same approach as lib/pdf/guest-pack.ts — pure Node.js, no headless Chrome).
 *
 * PDF structure:
 *   • Header: PodLever branding + episode title + upload date
 *   • Transcript body, paragraph-per-block with comfortable line spacing
 *   • Footer on every page: "Powered by PodLever · podlever.com — page N of M"
 *
 * HUMAN REVIEW NOTES:
 * - SECURITY: server-only — caller must verify episode ownership.
 * - Long transcripts paginate automatically; footers are stamped in a final
 *   buffered-pages pass with the bottom margin temporarily zeroed so the
 *   footer write can never trigger an accidental page break.
 */

import "server-only";
import PDFDocument from "pdfkit";

// ─── Brand constants (kept in sync with lib/pdf/guest-pack.ts) ────────────────

const BRAND = {
  primary: "#4F46E5",   // indigo-600
  dark:    "#1E1B4B",   // indigo-950
  text:    "#111827",   // gray-900
  muted:   "#6B7280",   // gray-500
};

const FONT = {
  heading: "Helvetica-Bold",
  body:    "Helvetica",
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TranscriptPdfInput {
  /** Episode title, printed in the header. */
  title:       string;
  /** Optional human-readable upload date, printed under the title. */
  uploadedAt?: string | null;
  /** Raw transcript text (plain text; blank lines separate paragraphs). */
  transcript:  string;
}

/**
 * generateTranscriptPdf — Render the transcript as a paginated, branded PDF.
 *
 * @param input  Episode title/date + transcript text
 * @returns      Raw PDF bytes as a Buffer
 */
export async function generateTranscriptPdf(input: TranscriptPdfInput): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size:        "LETTER",
      margins:     { top: 64, bottom: 64, left: 64, right: 64 },
      bufferPages: true,
      info:        { Title: `${input.title} — Transcript`, Author: "PodLever" },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // ── Header ────────────────────────────────────────────────────────────────
    doc.fillColor(BRAND.primary).font(FONT.heading).fontSize(10).text("PodLever");
    doc.moveDown(0.3);
    doc.fillColor(BRAND.dark).font(FONT.heading).fontSize(19).text(input.title, { width: contentWidth });
    if (input.uploadedAt) {
      doc.moveDown(0.2);
      doc.fillColor(BRAND.muted).font(FONT.body).fontSize(9).text(`Uploaded ${input.uploadedAt}`);
    }
    doc.moveDown(0.6);
    doc
      .strokeColor(BRAND.primary)
      .lineWidth(1.5)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown(0.9);

    doc.fillColor(BRAND.dark).font(FONT.heading).fontSize(12).text("Transcript");
    doc.moveDown(0.5);

    // ── Body ──────────────────────────────────────────────────────────────────
    const paragraphs = input.transcript
      .split(/\r?\n\s*\r?\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    doc.font(FONT.body).fontSize(10.5).fillColor(BRAND.text);
    if (paragraphs.length === 0) {
      doc.fillColor(BRAND.muted).text("(Transcript is empty.)");
    }
    for (const paragraph of paragraphs) {
      doc.text(paragraph, { width: contentWidth, lineGap: 3.5 });
      doc.moveDown(0.6);
    }

    // ── Footer pass (every page) ──────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // prevent footer write from paginating
      doc
        .font(FONT.body)
        .fontSize(8)
        .fillColor(BRAND.muted)
        .text(
          `Powered by PodLever · podlever.com — page ${i - range.start + 1} of ${range.count}`,
          doc.page.margins.left,
          doc.page.height - 42,
          { width: contentWidth, align: "center" },
        );
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}
