/**
 * app/actions/pipeline.actions.ts — Server Actions for the processing pipeline
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (Phase 1B — pipeline engine)
 *
 * Dependencies: @/providers/owner-guard, @/services (pipeline + episode + asset)
 *
 * HUMAN REVIEW NOTES:
 * This is the entry point David (or any owner) hits from the browser: upload a
 * recording, and this action creates an episode, runs the full pipeline, and
 * returns the generated assets for display.
 *
 * Auth: every action calls requireOwner() first. In Phase 1A the owner is the
 * single workspace owner (OWNER_REPLIT_USER_ID). To let an external tester like
 * David use the deployed app, add his Replit user id via OWNER_REPLIT_USER_ID or
 * extend the role assignment in @/providers/auth (tracked as a follow-up).
 *
 * File handling: Phase 1B processes the uploaded bytes in-memory (no object
 * storage yet). Large files are bounded by MAX_UPLOAD_BYTES to protect the
 * autoscale container. Phase 1C adds Replit Object Storage + a job queue so
 * long recordings process out-of-band.
 */

"use server";

import { requireOwner } from "@/providers/owner-guard";
import { episodeService, pipelineService, assetService } from "@/services";
import type { AudioMimeType } from "@/providers/transcription";
import type { Asset } from "@/db/schema";

/** Upper bound on in-memory uploads (25 MB) for the Phase 1B synchronous path. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Content types we accept for transcription. */
const ACCEPTED_MIME: readonly AudioMimeType[] = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-m4a",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
];

/** Serializable result returned to the client component. */
export type UploadAndProcessResult =
  | {
      ok: true;
      episodeId: string;
      episodeTitle: string;
      transcript: { content: string; confidence: number; durationSeconds: number };
      showNotes: { content: string; model: string };
      socialPosts: { content: string; model: string };
    }
  | { ok: false; error: string; step?: string };

/**
 * uploadAndProcessAction — Create an episode from an uploaded recording and run it.
 *
 * @param formData - Must contain `file` (the recording) and optional `title`.
 * @returns A serializable {@link UploadAndProcessResult} for the UI.
 *
 * Never throws to the client for expected failures — returns { ok: false }.
 * Unexpected errors are logged server-side and returned as a generic message.
 */
export async function uploadAndProcessAction(
  formData: FormData,
): Promise<UploadAndProcessResult> {
  const { userId } = await requireOwner();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No recording uploaded." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Recording is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit is 25 MB in this phase.`,
    };
  }

  const mimeType = normalizeMime(file.type);
  if (!mimeType) {
    return {
      ok: false,
      error: `Unsupported file type "${file.type}". Upload MP3, MP4, WAV, M4A, OGG, or WebM audio.`,
    };
  }

  const rawTitle = (formData.get("title") ?? "").toString().trim();
  const title = rawTitle.length > 0 ? rawTitle.slice(0, 255) : deriveTitle(file.name);

  try {
    const episode = await episodeService.createEpisode({ title }, userId);
    const audio = new Uint8Array(await file.arrayBuffer());

    const result = await pipelineService.processRecording({
      episodeId: episode.id,
      ownerId: userId,
      audio,
      mimeType,
    });

    return {
      ok: true,
      episodeId: result.episode.id,
      episodeTitle: result.episode.title,
      transcript: {
        content: result.transcript.asset.content ?? "",
        confidence: result.transcript.confidence,
        durationSeconds: result.transcript.durationSeconds,
      },
      showNotes: {
        content: result.showNotes.asset.content ?? "",
        model: result.showNotes.model,
      },
      socialPosts: {
        content: result.socialPosts.asset.content ?? "",
        model: result.socialPosts.model,
      },
    };
  } catch (err) {
    const step = (err as { step?: string })?.step;
    console.error("[pipeline] processing failed:", (err as Error).message, step ? `(step: ${step})` : "");
    return {
      ok: false,
      error: "Processing failed. Check that the file is a valid recording and try again.",
      step,
    };
  }
}

/**
 * listEpisodeAssetsAction — List generated assets for an episode (owner-scoped).
 */
export async function listEpisodeAssetsAction(episodeId: string): Promise<Asset[]> {
  const { userId } = await requireOwner();
  return assetService.listAssetsForEpisode(episodeId, userId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map a browser-provided content type to a supported AudioMimeType, or null. */
function normalizeMime(type: string): AudioMimeType | null {
  const t = type.split(";")[0]!.trim().toLowerCase();
  const found = ACCEPTED_MIME.find((m) => m === t);
  return found ?? null;
}

/** Derive a readable episode title from an uploaded file name. */
function deriveTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return (base.length > 0 ? base : "Untitled recording").slice(0, 255);
}
