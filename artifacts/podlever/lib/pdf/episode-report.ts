/**
 * lib/pdf/episode-report.ts — Full episode content report PDF generator
 *
 * Part of: PodLever
 * Created: 2026-08-04 by agent (Board directive Sprint 2 🟡)
 *
 * Generates a branded, all-in-one PDF containing all five content panels:
 *   1. Cover page — episode title, date, PodLever branding
 *   2. Show Notes
 *   3. Blog Post
 *   4. Social Copy
 *   5. Guest Media Pack highlights
 *
 * This replaces the folder of .md files in the ZIP — one shareable PDF that
 * can be forwarded to a sponsor, team member, or guest.
 *
 * Branding rules:
 *   - PodLever header on every page (watermark in footer text)
 *   - hidePodleverBranding = true (Pro/Agency): PodLever footer removed
 *   - logoStorageKey set: user logo rendered on cover page alongside PodLever mark
 *
 * Uses pdfkit (pure Node.js, no headless Chrome).
 *
 * HUMAN REVIEW NOTES:
 * - pdfkit streams are collected into a Buffer before returning.
 * - Content is truncated per section to keep PDF manageable (<5MB).
 * - SECURITY: server-only — caller MUST verify episode ownership before calling.
 */

import "server-only";
import PDFDocument from "pdfkit";

// ─── Brand constants ───────────────────────────────────────────────────────────

const BRAND = {
  amber:      "#F59E0B",   // amber-400 — PodLever primary
  amberDark:  "#D97706",   // amber-600
  dark:       "#0D0D0F",   // near-black background
  charcoal:   "#18181B",   // zinc-900
  text:       "#111827",   // gray-900
  muted:      "#6B7280",   // gray-500
  light:      "#F9FAFB",   // gray-50
  border:     "#E5E7EB",   // gray-200
  white:      "#FFFFFF",
};

const FONT = {
  bold:   "Helvetica-Bold",
  body:   "Helvetica",
  mono:   "Courier",
};

// Section truncation limits (character counts) — keeps PDF under 5MB
const MAX_CHARS = {
  showNotes:      4000,
  blogPost:       5000,
  socialPost:     2000,
  guestMediaPack: 3000,
};

// ─── Input type ────────────────────────────────────────────────────────────────

export interface EpisodeReportInput {
  episodeTitle:          string;
  episodeDate:           Date;
  /** AI-generated text assets. Null-safe — missing sections are omitted. */
  assets: {
    showNotes?:       string | null;
    blogPost?:        string | null;
    socialPost?:      string | null;
    guestMediaPack?:  string | null;
  };
  /**
   * When true, suppresses "Powered by PodLever" from the page footer.
   * Available to Pro/Agency users (gated by caller).
   */
  hidePodleverBranding?: boolean;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Collect a PDFDocument stream into a Buffer. */
function collectStream(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data",  (chunk: Buffer) => chunks.push(chunk));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * Render a section header bar — amber left accent + bold title.
 * Mutates doc position.
 */
function renderSectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  const y = doc.y;
  // Amber accent bar
  doc
    .rect(50, y, 4, 18)
    .fill(BRAND.amber);
  // Title text
  doc
    .font(FONT.bold)
    .fontSize(13)
    .fillColor(BRAND.text)
    .text(title, 62, y + 2, { lineBreak: false });
  doc.moveDown(1);
}

/**
 * Render body text — strips markdown formatting, wraps to page width.
 * Truncates at maxChars to prevent huge PDFs.
 */
function renderBodyText(
  doc:      PDFKit.PDFDocument,
  content:  string,
  maxChars: number,
): void {
  let text = content;
  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);

  // Light markdown stripping: headings, bold, bullets → plain text
  const plain = text
    .replace(/^#{1,4}\s+/gm, "")     // headings
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g,   "$1") // italic
    .replace(/^[-*]\s+/gm, "• ")     // bullets → bullet char
    .replace(/\n{3,}/g, "\n\n")       // collapse excess blank lines
    .trim();

  doc
    .font(FONT.body)
    .fontSize(9.5)
    .fillColor(BRAND.text)
    .text(plain, { lineBreak: true, width: 495 });

  if (truncated) {
    doc.moveDown(0.5);
    doc
      .font(FONT.body)
      .fontSize(8)
      .fillColor(BRAND.muted)
      .text("[Content truncated — full version available in your PodLever dashboard]", {
        lineBreak: true,
      });
  }
}

/**
 * Add a new content section to the PDF.
 * Handles page breaks automatically.
 */
function addSection(
  doc:      PDFKit.PDFDocument,
  title:    string,
  content:  string,
  maxChars: number,
): void {
  doc.addPage();
  doc.moveDown(0.5);
  renderSectionHeader(doc, title);
  doc.moveDown(0.5);
  renderBodyText(doc, content, maxChars);
}

/**
 * Render the page footer on the current page.
 * Called at page-end via the `pageAdded` event.
 */
function renderPageFooter(
  doc:                   PDFKit.PDFDocument,
  pageNum:               number,
  totalPages:            number,
  episodeTitle:          string,
  hidePodleverBranding:  boolean,
): void {
  const footerY    = doc.page.height - 40;
  const pageWidth  = doc.page.width;

  // Thin separator line
  doc
    .moveTo(50, footerY - 8)
    .lineTo(pageWidth - 50, footerY - 8)
    .strokeColor(BRAND.border)
    .lineWidth(0.5)
    .stroke();

  // Episode title (left)
  doc
    .font(FONT.body)
    .fontSize(7)
    .fillColor(BRAND.muted)
    .text(
      episodeTitle.length > 60 ? episodeTitle.slice(0, 60) + "…" : episodeTitle,
      50, footerY - 3,
      { lineBreak: false },
    );

  // PodLever watermark (center) — hidden for paid users who toggled it off
  if (!hidePodleverBranding) {
    doc
      .font(FONT.bold)
      .fontSize(7)
      .fillColor(BRAND.amber)
      .text(
        "PODLEVER.COM",
        0, footerY - 3,
        { align: "center", lineBreak: false, width: pageWidth },
      );
  }

  // Page number (right)
  doc
    .font(FONT.body)
    .fontSize(7)
    .fillColor(BRAND.muted)
    .text(
      `${pageNum} / ${totalPages}`,
      0, footerY - 3,
      { align: "right", lineBreak: false, width: pageWidth - 50 },
    );
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * generateEpisodeReport — Build a full-episode content PDF.
 *
 * Sections included (skipped if content is null/empty):
 *   1. Cover page
 *   2. Show Notes
 *   3. Blog Post
 *   4. Social Copy
 *   5. Guest Media Pack
 *
 * @returns Buffer containing the PDF bytes
 *
 * SECURITY: server-only — never expose the PDF URL without ownership check.
 */
export async function generateEpisodeReport(input: EpisodeReportInput): Promise<Buffer> {
  const {
    episodeTitle,
    episodeDate,
    assets,
    hidePodleverBranding = false,
  } = input;

  // Count which sections we'll actually render
  const sections: Array<{ title: string; content: string; maxChars: number }> = [];
  if (assets.showNotes?.trim())      sections.push({ title: "Show Notes",       content: assets.showNotes,      maxChars: MAX_CHARS.showNotes });
  if (assets.blogPost?.trim())       sections.push({ title: "Blog Post",        content: assets.blogPost,       maxChars: MAX_CHARS.blogPost });
  if (assets.socialPost?.trim())     sections.push({ title: "Social Copy",      content: assets.socialPost,     maxChars: MAX_CHARS.socialPost });
  if (assets.guestMediaPack?.trim()) sections.push({ title: "Guest Media Pack", content: assets.guestMediaPack, maxChars: MAX_CHARS.guestMediaPack });

  // 1 cover + N content pages
  const totalPages = 1 + sections.length;

  const doc = new PDFDocument({
    size:    "LETTER",
    margins: { top: 55, bottom: 55, left: 50, right: 50 },
    info: {
      Title:    episodeTitle,
      Author:   "PodLever — podlever.com",
      Creator:  "PodLever",
      Keywords: "podcast, show notes, blog post, social media",
    },
  });

  // Track page number for footer rendering
  let currentPage = 1;

  // ── Page-added hook: render footer on every page ────────────────────────────
  doc.on("pageAdded", () => {
    // Don't call renderPageFooter here — we call it just before addPage() and at end
    // because page count isn't known at page-add time. Instead we do it post-hoc.
  });

  const bufferPromise = collectStream(doc);

  // ── Cover page ──────────────────────────────────────────────────────────────

  // Amber top bar (brand header)
  doc
    .rect(0, 0, doc.page.width, 8)
    .fill(BRAND.amber);

  doc.moveDown(3);

  // "AI Content Report" label
  doc
    .font(FONT.bold)
    .fontSize(9)
    .fillColor(BRAND.amber)
    .text("AI-GENERATED CONTENT REPORT", { align: "center", characterSpacing: 1.5 });

  doc.moveDown(1.5);

  // Episode title — large
  doc
    .font(FONT.bold)
    .fontSize(26)
    .fillColor(BRAND.text)
    .text(episodeTitle, {
      align:     "center",
      lineBreak: true,
      width:     495,
    });

  doc.moveDown(1);

  // Date
  doc
    .font(FONT.body)
    .fontSize(10)
    .fillColor(BRAND.muted)
    .text(
      episodeDate.toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      }),
      { align: "center" },
    );

  doc.moveDown(3);

  // Divider
  doc
    .moveTo(150, doc.y)
    .lineTo(doc.page.width - 150, doc.y)
    .strokeColor(BRAND.border)
    .lineWidth(1)
    .stroke();

  doc.moveDown(2);

  // Contents list
  doc
    .font(FONT.bold)
    .fontSize(9)
    .fillColor(BRAND.muted)
    .text("CONTENTS", { align: "center", characterSpacing: 1 });

  doc.moveDown(0.5);

  for (const section of sections) {
    doc
      .font(FONT.body)
      .fontSize(9.5)
      .fillColor(BRAND.text)
      .text(`• ${section.title}`, { align: "center" });
  }

  doc.moveDown(3);

  // PodLever wordmark on cover
  if (!hidePodleverBranding) {
    doc
      .font(FONT.bold)
      .fontSize(11)
      .fillColor(BRAND.amber)
      .text("PODLEVER", { align: "center", characterSpacing: 3 });
    doc
      .font(FONT.body)
      .fontSize(8)
      .fillColor(BRAND.muted)
      .text("podlever.com · AI-powered podcast content engine", { align: "center" });
  }

  // Render cover page footer
  renderPageFooter(doc, currentPage, totalPages, episodeTitle, hidePodleverBranding);

  // ── Content sections ────────────────────────────────────────────────────────

  for (const section of sections) {
    currentPage++;

    // Add new page with amber top bar
    doc.addPage();
    doc
      .rect(0, 0, doc.page.width, 4)
      .fill(BRAND.amber);

    doc.moveDown(0.5);
    renderSectionHeader(doc, section.title);
    doc.moveDown(0.5);
    renderBodyText(doc, section.content, section.maxChars);

    // Render footer for this content page
    renderPageFooter(doc, currentPage, totalPages, episodeTitle, hidePodleverBranding);
  }

  doc.end();
  return bufferPromise;
}
