/**
 * lib/zip-export.ts — Bundle all episode assets into a downloadable ZIP
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — ZIP bulk export)
 *
 * Packages all text assets (markdown files) and audio (via GCS) into a ZIP
 * so podcasters can download their full content suite in one click.
 *
 * File layout in ZIP:
 *   podlever-{slug}/
 *     transcript.txt
 *     show-notes.md
 *     blog-post.md
 *     social-posts.md
 *     guest-media-pack.md
 *     original-audio.{ext}      (if available)
 *     cleaned-audio.{mp3|wav}   (if audio enhancement ran)
 *     _meta.json                (episode metadata)
 *
 * HUMAN REVIEW NOTES:
 * - Audio files are fetched from GCS inline during ZIP build.
 *   For episodes > 50MB audio, consider streaming instead of buffering.
 * - JSZip generates the ZIP in memory — suitable for files up to ~200MB.
 *   At higher volume add server-side streaming with archiver.
 * - SECURITY: server-only — caller must verify episode ownership before calling.
 */

import "server-only";
import JSZip               from "jszip";
import { downloadAudioBuffer } from "@/lib/storage";
import { generateTranscriptPdf } from "@/lib/pdf/transcript";
import type { Asset }      from "@/db/schema";

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
    /** GCS key for original audio; null if not uploaded. */
    audioStorageKey:        string | null;
    /** GCS key for enhanced audio; null if enhancement didn't run. */
    cleanedAudioStorageKey: string | null;
  };
  /** Latest-version assets for this episode. */
  assets: Asset[];
  /** Include original/cleaned audio (default true). Text-only ZIPs are much
   *  smaller and cannot fail on large-audio memory limits. */
  includeAudio?: boolean;
}

/**
 * buildEpisodeZip — Generate a ZIP buffer containing all episode assets.
 *
 * @param input  Episode metadata + assets array
 * @returns      Raw ZIP bytes as a Buffer
 *
 * Fails gracefully per asset: if one file can't be added (e.g. GCS timeout),
 * it's skipped with a warning — the rest of the ZIP is still returned.
 */
export async function buildEpisodeZip(input: ZipInput): Promise<Buffer> {
  const { episode, assets } = input;

  // Slugify the episode title for the folder name (safe filesystem chars only)
  const slug = episode.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || episode.id;

  const zip    = new JSZip();
  const folder = zip.folder(`podlever-${slug}`)!;

  // ── Text assets ─────────────────────────────────────────────────────────────
  // Keep only the latest version of each asset type (caller should pre-filter,
  // but we deduplicate here as defense-in-depth).
  const latestByType = new Map<string, Asset>();
  for (const asset of assets) {
    if (!latestByType.has(asset.assetType)) {
      latestByType.set(asset.assetType, asset);
    }
  }

  for (const [assetType, asset] of latestByType) {
    const filename = ASSET_FILENAMES[assetType];
    if (!filename || !asset.content) continue;
    folder.file(filename, asset.content, { date: new Date(asset.createdAt) });
  }

  // ── Transcript PDF ───────────────────────────────────────────────────────────
  // Users expect a PDF alongside the plain-text transcript (support request,
  // 2026-07-28). Failure to render is non-fatal — the txt is still included.
  const transcriptAsset = latestByType.get("transcript");
  if (transcriptAsset?.content) {
    try {
      const pdf = await generateTranscriptPdf({
        title:      episode.title,
        transcript: transcriptAsset.content,
      });
      folder.file("transcript.pdf", pdf);
    } catch (err) {
      console.warn(JSON.stringify({
        event:     "zip_export.transcript_pdf_skip",
        episodeId: episode.id,
        error:     String(err),
      }));
    }
  }

  // ── Original audio ───────────────────────────────────────────────────────────
  const includeAudio = input.includeAudio !== false;
  if (includeAudio && episode.audioStorageKey) {
    try {
      const ext    = episode.audioStorageKey.split(".").pop() ?? "mp3";
      const buffer = await downloadAudioBuffer(episode.audioStorageKey);
      folder.file(`original-audio.${ext}`, buffer);
    } catch (err) {
      console.warn(JSON.stringify({
        event:     "zip_export.audio_skip",
        episodeId: episode.id,
        key:       episode.audioStorageKey,
        error:     String(err),
      }));
    }
  }

  // ── Cleaned audio (enhanced output) ───────────────────────────────────────────
  if (includeAudio && episode.cleanedAudioStorageKey) {
    try {
      const buffer = await downloadAudioBuffer(episode.cleanedAudioStorageKey);
      const cleanedExt = episode.cleanedAudioStorageKey.split(".").pop() ?? "mp3";
      folder.file(`cleaned-audio.${cleanedExt}`, buffer);
    } catch (err) {
      console.warn(JSON.stringify({
        event:     "zip_export.cleaned_audio_skip",
        episodeId: episode.id,
        error:     String(err),
      }));
    }
  }

  // ── Meta JSON ────────────────────────────────────────────────────────────────
  folder.file("_meta.json", JSON.stringify({
    generatedBy: "PodLever — podlever.com",
    episodeId:   episode.id,
    title:       episode.title,
    exportedAt:  new Date().toISOString(),
    assets:      [...latestByType.keys()],
  }, null, 2));

  // ── Generate ZIP ─────────────────────────────────────────────────────────────
  const zipBuffer = await zip.generateAsync({
    type:               "nodebuffer",
    compression:        "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return zipBuffer;
}
