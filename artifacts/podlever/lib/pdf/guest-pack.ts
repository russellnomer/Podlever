/**
 * lib/pdf/guest-pack.ts — Guest media pack PDF generator
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — highest differentiation feature)
 *
 * Generates a professionally formatted PDF from the GPT-produced guest_media_pack
 * markdown content. This is PodLever's most differentiated feature — no competitor
 * (Castmagic, Descript, Opus Clip) offers a guest pack.
 *
 * PDF structure:
 *   • Header: PodLever branding + episode title
 *   • Guest info section (name, bio blurb)
 *   • Key topics discussed
 *   • Notable quotes
 *   • Suggested social announcement
 *   • Suggested follow-up questions
 *   • Footer: "Powered by PodLever · podlever.com"
 *
 * Uses pdfkit (pure Node.js, no headless Chrome needed).
 *
 * HUMAN REVIEW NOTES:
 * - pdfkit generates a stream; we collect into a Buffer for GCS upload.
 * - The guest_media_pack content is GPT-generated markdown. We parse it with
 *   simple regex section detection (no full MD parser needed for this layout).
 * - SECURITY: server-only — caller must verify episode ownership.
 */

import "server-only";
import PDFDocument from "pdfkit";

// ─── Brand constants ──────────────────────────────────────────────────────────

const BRAND = {
  primary:    "#4F46E5",   // indigo-600
  dark:       "#1E1B4B",   // indigo-950
  text:       "#111827",   // gray-900
  muted:      "#6B7280",   // gray-500
  light:      "#EEF2FF",   // indigo-50
  white:      "#FFFFFF",
  accent:     "#7C3AED",   // violet-600
};

const FONT = {
  heading:    "Helvetica-Bold",
  body:       "Helvetica",
  mono:       "Courier",
};

// ─── Markdown section parser ───────────────────────────────────────────────────

interface ParsedPack {
  guestName:        string;
  bio:              string;
  topics:           string[];
  quotes:           string[];
  socialAnnounce:   string;
  followUpQuestions: string[];
  rawContent:       string;
}

/**
 * parseGuestPackContent — Extract structured sections from GPT-generated markdown.
 * Uses simple heading/bullet detection — no full markdown parser needed.
 */
function parseGuestPackContent(content: string): ParsedPack {
  const lines = content.split("\n");
  let guestName        = "";
  let bio              = "";
  const topics:           string[] = [];
  const quotes:           string[] = [];
  let socialAnnounce   = "";
  const followUpQuestions: string[] = [];

  let currentSection = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section headings (bold markdown: **Heading**)
    const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      const heading = boldMatch[1]?.toLowerCase() ?? "";
      if (heading.includes("guest name") || heading.includes("guest")) {
        // Extract the name if inline: "**Guest Name:** John Doe"
        const inline = trimmed.replace(/^\*\*[^*]+\*\*:?\s*/, "").trim();
        if (inline) guestName = inline;
        currentSection = "guest_name";
      } else if (heading.includes("bio")) {
        const inline = trimmed.replace(/^\*\*[^*]+\*\*:?\s*/, "").trim();
        if (inline) bio = inline;
        currentSection = "bio";
      } else if (heading.includes("topic")) {
        currentSection = "topics";
      } else if (heading.includes("quote")) {
        currentSection = "quotes";
      } else if (heading.includes("social")) {
        currentSection = "social";
      } else if (heading.includes("follow")) {
        currentSection = "followup";
      }
      continue;
    }

    // Accumulate section content
    const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("• ");
    const bulletText = isBullet ? trimmed.slice(2) : trimmed;

    switch (currentSection) {
      case "bio":
        if (!bio) bio = bulletText;
        break;
      case "topics":
        if (isBullet || topics.length === 0) topics.push(bulletText);
        break;
      case "quotes":
        // Match plain quotes, curly left/right double quotes (U+201C / U+201D)
        if (isBullet || trimmed.startsWith('"') || trimmed.startsWith('\u201C')) {
          quotes.push(bulletText.replace(/^["\u201C\u201D]|["\u201C\u201D]$/g, ""));
        }
        break;
      case "social":
        if (!socialAnnounce) socialAnnounce = trimmed;
        else socialAnnounce += " " + trimmed;
        break;
      case "followup":
        if (isBullet || /^\d+\./.test(trimmed)) {
          followUpQuestions.push(bulletText.replace(/^\d+\.\s*/, ""));
        }
        break;
      case "guest_name":
        if (!guestName) guestName = trimmed;
        break;
    }
  }

  return {
    guestName:        guestName || "Your Guest",
    bio:              bio || "",
    topics:           topics.slice(0, 7),
    quotes:           quotes.slice(0, 3),
    socialAnnounce:   socialAnnounce || "",
    followUpQuestions: followUpQuestions.slice(0, 3),
    rawContent:       content,
  };
}

// ─── PDF layout helpers ───────────────────────────────────────────────────────

function sectionHeader(doc: InstanceType<typeof PDFDocument>, text: string, y?: number): void {
  if (y !== undefined) doc.y = y;
  doc
    .moveDown(0.5)
    .rect(doc.x, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 24)
    .fill(BRAND.light)
    .fillColor(BRAND.primary)
    .font(FONT.heading)
    .fontSize(10)
    .text(text.toUpperCase(), { continued: false })
    .fillColor(BRAND.text)
    .font(FONT.body)
    .fontSize(10)
    .moveDown(0.4);
}

function bulletItem(doc: InstanceType<typeof PDFDocument>, text: string): void {
  doc
    .fillColor(BRAND.primary)
    .text("▸  ", { continued: true })
    .fillColor(BRAND.text)
    .text(text)
    .moveDown(0.2);
}

function quoteBlock(doc: InstanceType<typeof PDFDocument>, text: string): void {
  const leftX = doc.page.margins.left + 12;
  const width  = doc.page.width - doc.page.margins.left - doc.page.margins.right - 24;

  doc
    .rect(doc.page.margins.left, doc.y, 4, 38)
    .fill(BRAND.accent)
    .fillColor(BRAND.muted)
    .font("Helvetica-Oblique")
    .fontSize(9.5)
    .text(`"${text}"`, leftX, doc.y, { width, lineGap: 3 })
    .font(FONT.body)
    .fillColor(BRAND.text)
    .fontSize(10)
    .moveDown(0.5);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface GuestPackInput {
  episodeTitle: string;
  /** Raw markdown content from the guest_media_pack asset. */
  content:      string;
  /** Episode creation date for the header. */
  episodeDate:  Date;
}

/**
 * generateGuestPackPdf — Produce a branded PDF guest media pack.
 *
 * @param input  Episode metadata + GPT-generated content
 * @returns      Raw PDF bytes as a Buffer
 */
export async function generateGuestPackPdf(input: GuestPackInput): Promise<Buffer> {
  const { episodeTitle, content, episodeDate } = input;
  const pack = parseGuestPackContent(content);

  return new Promise<Buffer>((resolve, reject) => {
    const doc     = new PDFDocument({ size: "LETTER", margins: { top: 50, bottom: 50, left: 60, right: 60 } });
    const chunks: Buffer[] = [];

    doc.on("data",  (chunk: Buffer) => chunks.push(chunk));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // ── Header band ────────────────────────────────────────────────────────────
    doc
      .rect(0, 0, doc.page.width, 90)
      .fill(BRAND.dark)
      .fillColor(BRAND.white)
      .font(FONT.heading)
      .fontSize(7)
      .text("GUEST MEDIA PACK", doc.page.margins.left, 22)
      .fontSize(16)
      .text("PodLever", doc.page.margins.left, 34)
      .fillColor("#A5B4FC")   // indigo-300
      .font(FONT.body)
      .fontSize(8)
      .text("podlever.com  ·  AI-powered podcast content engine", doc.page.margins.left, 56);

    // Episode title
    doc
      .rect(0, 90, doc.page.width, 52)
      .fill(BRAND.primary)
      .fillColor(BRAND.white)
      .font(FONT.heading)
      .fontSize(13)
      .text(episodeTitle, doc.page.margins.left, 102, { width: pageWidth - 80, ellipsis: true })
      .fillColor("#C7D2FE")   // indigo-200
      .font(FONT.body)
      .fontSize(8)
      .text(
        episodeDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        doc.page.margins.left,
        120,
      );

    doc.y = 160;
    doc.fillColor(BRAND.text);

    // ── Guest intro ────────────────────────────────────────────────────────────
    sectionHeader(doc, "About the Guest");

    doc
      .font(FONT.heading)
      .fontSize(13)
      .fillColor(BRAND.dark)
      .text(pack.guestName)
      .moveDown(0.3);

    if (pack.bio) {
      doc
        .font(FONT.body)
        .fontSize(10)
        .fillColor(BRAND.text)
        .text(pack.bio, { lineGap: 3, width: pageWidth })
        .moveDown(0.5);
    }

    // ── Key topics ─────────────────────────────────────────────────────────────
    if (pack.topics.length > 0) {
      sectionHeader(doc, "Key Topics Discussed");
      for (const topic of pack.topics) {
        bulletItem(doc, topic);
      }
    }

    // ── Notable quotes ─────────────────────────────────────────────────────────
    if (pack.quotes.length > 0) {
      sectionHeader(doc, "Notable Quotes");
      for (const quote of pack.quotes) {
        quoteBlock(doc, quote);
      }
    }

    // ── Suggested social copy ──────────────────────────────────────────────────
    if (pack.socialAnnounce) {
      sectionHeader(doc, "Suggested Social Announcement");
      doc
        .rect(doc.x, doc.y, pageWidth, 2)
        .fill(BRAND.light)
        .moveDown(0.2)
        .fillColor(BRAND.text)
        .font("Helvetica-Oblique")
        .fontSize(10)
        .text(pack.socialAnnounce, { width: pageWidth, lineGap: 3 })
        .font(FONT.body)
        .moveDown(0.5);
    }

    // ── Follow-up questions ────────────────────────────────────────────────────
    if (pack.followUpQuestions.length > 0) {
      sectionHeader(doc, "Suggested Follow-Up Questions");
      pack.followUpQuestions.forEach((q, i) => {
        doc
          .fillColor(BRAND.primary)
          .font(FONT.heading)
          .text(`Q${i + 1}  `, { continued: true })
          .fillColor(BRAND.text)
          .font(FONT.body)
          .text(q)
          .moveDown(0.3);
      });
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 30;
    doc
      .rect(0, footerY, doc.page.width, 1)
      .fill(BRAND.primary)
      .fillColor(BRAND.muted)
      .font(FONT.body)
      .fontSize(7.5)
      .text(
        `This media pack was auto-generated by PodLever · podlever.com · ${new Date().toLocaleDateString("en-US")}`,
        doc.page.margins.left,
        footerY + 8,
        { width: pageWidth, align: "center" },
      );

    doc.end();
  });
}
