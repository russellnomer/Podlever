/**
 * lib/zip-export.ts — Bundle all episode text assets + PDF report into a downloadable ZIP
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-08-04 by agent (Board Sprint 2 — replace .md files with PDF report;
 *                                      remove inline audio download that caused prod timeouts)
 *
 * Packages text assets and an AI-generated episode report PDF into a ZIP.
 * Audio files are NOT included here — they are available via separate signed-URL
 * download buttons on the episode page (avoids 30s+ GCS download timeouts in prod).
 *
 * File layout in ZIP:
 *   podlever-{slug}/
 *     episode-report.pdf         ← all 5 content panels in one branded PDF (NEW)
 *     transcript.txt             ← verbatim transcript (plain text, easy to copy-paste)
 *     show-notes.md              ← markdown versions still included for programmatic use
 *     blog-post.md
 *     social-posts.md
 *     guest-media-pack.md
 *     _meta.json                 ← episode metadata + enhancement status
 *
 * HUMAN REVIEW NOTES:
 * - The PDF is generated synchronously on ZIP creation — adds ~1-2s but keeps
 *   the ZIP self-contained. At very high volume, pre-generate on episode complete.
 * - JSZip generates the ZIP in memory — suitable for files up to ~200MB.
 * - SECURITY: server-only — caller must verify episode ownership before calling.
 */

import "server-only";
import JSZip               from "jszip";
import type { Asset }      from "@/db/schema";
import { generateEpisodeReport } from "@/lib/pdf/episode-report";

// ─── Asset type → filename map ────────────────────────────────────────────────

const ASSET_FILENAMES: Partial<Record<string, string>> = {
  transcript:       "transcript.txt",
  show_notes:       "show-notes.md",
  blog_post:        "blog-post.md",
  social_post:      "social-posts.md",
  guest_media_pack: "guest-media-pack.md",
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ZipInput {
  episode: {
    id:    string;
    title: string;
    createdAt: Date | string;
    /** GCS key for original audio; not included in ZIP (separate download). */
    audioStorageKey:        string | null;
    /** GCS key for enhanced audio; not included in ZIP (separate download). */
    cleanedAudioStorageKey: string | null;
    /** Result of audio enhancement step — shown in _meta.json. */
    audioEnhancementStatus?: string | null;
  };
  /** Latest-version assets for this episode. */
  assets: Asset[];
  /**
   * When true, suppresses "Powered by PodLever" from the generated PDF.
   * Available to Pro/Agency users (gated by the ZIP route before calling here).
   */
  hidePodleverBranding?: boolean;
}

/**
 * buildEpisodeZip — Generate a ZIP buffer containing all episode assets.
 *
 * Includes:
 *   - An episode report PDF (all 5 content panels, branded)
 *   - Markdown text files for each asset type (for programmatic/copy-paste use)
 *   - A _meta.json with episode metadata and audio enhancement status
 *
 * Audio files are intentionally excluded from ZIP to prevent timeout failures
 * in production. Audio is available via separate signed-URL download buttons
 * on the episode page.
 *
 * @param input  Episode metadata + assets array + branding prefs
 * @returns      Raw ZIP bytes as a Buffer
 *
 * Fails gracefully per asset: if one file can't be added, it's skipped with
 * a warning — the rest of the ZIP is still returned.
 */
export async function buildEpisodeZip(input: ZipInput): Promise<Buffer> {
  const { episode, assets, hidePodleverBranding = false } = input;

  // Slugify the episode title for the folder name (safe filesystem chars only)
  const slug = episode.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || episode.id;

  const zip    = new JSZip();
  const folder = zip.folder(`podlever-${slug}`)!;

  // ── Deduplicate: keep only latest version of each asset type ──────────────
  const latestByType = new Map<string, Asset>();
  for (const asset of assets) {
    if (!latestByType.has(asset.assetType)) {
      latestByType.set(asset.assetType, asset);
    }
  }

  // ── Episode report PDF (all-in-one branded PDF) ───────────────────────────
  // The PDF replaces the manual "open 5 .md files" workflow with a single
  // shareable document. Generated on ZIP creation (~1-2s overhead).
  try {
    const episodeDate = episode.createdAt
      ? new Date(episode.createdAt)
      : new Date();

    const pdfBuffer = await generateEpisodeReport({
      episodeTitle: episode.title,
      episodeDate,
      assets: {
        showNotes:      latestByType.get("show_notes")?.content     ?? null,
        blogPost:       latestByType.get("blog_post")?.content      ?? null,
        socialPost:     latestByType.get("social_post")?.content    ?? null,
        guestMediaPack: latestByType.get("guest_media_pack")?.content ?? null,
      },
      hidePodleverBranding,
    });

    folder.file("episode-report.pdf", pdfBuffer);
  } catch (err) {
    // Non-fatal — text files still included even if PDF generation fails.
    console.warn(JSON.stringify({
      event:     "zip_export.pdf_skip",
      episodeId: episode.id,
      error:     String(err),
    }));
  }

  // ── Text assets (markdown + transcript) ───────────────────────────────────
  // Retained for copy-paste workflows and programmatic use (e.g. Notion import).
  for (const [assetType, asset] of latestByType) {
    const filename = ASSET_FILENAMES[assetType];
    if (!filename || !asset.content) continue;
    folder.file(filename, asset.content, { date: new Date(asset.createdAt) });
  }

  // ── Meta JSON ─────────────────────────────────────────────────────────────
  // Includes enhancement status so downstream tools can inspect it.
  folder.file("_meta.json", JSON.stringify({
    generatedBy:            "PodLever — podlever.com",
    episodeId:              episode.id,
    title:                  episode.title,
    exportedAt:             new Date().toISOString(),
    assets:                 [...latestByType.keys()],
    audioEnhancementStatus: episode.audioEnhancementStatus ?? null,
    note:                   "Audio files are available for separate download on your episode page.",
  }, null, 2));

  // ── Generate ZIP ──────────────────────────────────────────────────────────
  const zipBuffer = await zip.generateAsync({
    type:               "nodebuffer",
    compression:        "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return zipBuffer;
}
