/**
 * app/actions/episode.actions.ts — Server Actions for Episode operations
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T7 — Owner role protection)
 *
 * Dependencies: @/providers/owner-guard, @/services/episode.service
 *
 * HUMAN REVIEW NOTES:
 * Server Actions are the ONLY mutation entry point in Phase 1A (no Route Handlers).
 * This enforces the T3 Decision B: "Server Actions only — no Route Handlers in Phase 1A."
 *
 * Every action:
 *   1. Calls requireOwner() — throws UnauthorizedError or ForbiddenError if not owner
 *   2. Delegates to the service layer with the authenticated userId
 *   3. Returns the result or re-throws typed errors for the UI to handle
 *
 * Error handling contract for UI callers:
 *   - UnauthorizedError (401): redirect to /auth/login
 *   - ForbiddenError (403): show "access denied" message
 *   - EpisodeNotFoundError: show "not found" message
 *   - OptimisticLockError: prompt user to refresh and retry
 *   - InvalidTransitionError: show which transitions are valid
 *   - ZodError: form validation failed — show field errors
 *
 * "use server" directive marks these as Server Actions for Next.js.
 * They are serialized function references — never imported by client code directly.
 */

"use server";

import { z }              from "zod";
import { redirect }       from "next/navigation";
import { after }          from "next/server";
import { requireOwner }   from "@/providers/owner-guard";
import { episodeService } from "@/services";
import { episodeRepository, assetRepository } from "@/repositories";
import { uploadAudioBuffer } from "@/lib/storage";
import { executeTransition } from "@/server/fsm";
import { trackServerEvent }  from "@/lib/analytics";
import { randomUUID }     from "crypto";
import type { Episode }   from "@/db/schema";
import type { TransitionResult } from "@/server/fsm";

/** Reusable UUID validator for episodeId parameters */
const EpisodeIdSchema = z.string().uuid("episodeId must be a valid UUID");

/**
 * createEpisodeAction — Create a new episode in draft state.
 *
 * @param input - Raw episode data (validated by EpisodeService via Zod)
 * @returns The newly created Episode row
 * @throws UnauthorizedError, ForbiddenError, ZodError
 */
export async function createEpisodeAction(
  input: unknown,
): Promise<Episode> {
  const { userId } = await requireOwner();
  return episodeService.createEpisode(input, userId);
}

/**
 * listEpisodesAction — List all active episodes for the authenticated owner.
 *
 * @returns Array of episodes (draft, processing, ready, published — not archived)
 * @throws UnauthorizedError, ForbiddenError
 */
export async function listEpisodesAction(): Promise<Episode[]> {
  const { userId } = await requireOwner();
  return episodeService.listEpisodes(userId);
}

/**
 * getEpisodeAction — Fetch a single episode by ID for the authenticated owner.
 *
 * @param episodeId - UUID of the episode
 * @returns The episode row
 * @throws UnauthorizedError, ForbiddenError, EpisodeNotFoundError
 */
export async function getEpisodeAction(episodeId: string): Promise<Episode> {
  const { userId } = await requireOwner();
  // Validate UUID format before passing to the DB layer — prevents malformed UUIDs
  // from reaching PostgreSQL and leaking DB error details to the caller.
  const validatedId = EpisodeIdSchema.parse(episodeId);
  return episodeService.getEpisode(validatedId, userId);
}

/**
 * transitionEpisodeAction — Execute a validated FSM state transition.
 *
 * @param input - Transition request (episodeId, toState, idempotencyKey, currentFsmVersion)
 * @returns TransitionResult with updated episode and idempotentReplay flag
 * @throws UnauthorizedError, ForbiddenError, InvalidTransitionError, OptimisticLockError
 */
export async function transitionEpisodeAction(
  input: unknown,
): Promise<TransitionResult> {
  const { userId } = await requireOwner();
  return episodeService.transitionEpisode(input, userId);
}

// ─── Audio upload + processing ────────────────────────────────────────────────

/** Max audio file size accepted by this action (25MB — OpenAI Whisper hard limit). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Allowed audio MIME types. */
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg",
  "audio/flac", "audio/x-m4a", "audio/mp3",
]);

/**
 * uploadEpisodeAction — Full upload + processing trigger for a new episode.
 *
 * Accepts a FormData submission from EpisodeUploadForm with fields:
 *   - title: string — episode title
 *   - audio: File  — audio file (mp3 / m4a / wav / ogg / flac, max 25MB)
 *
 * Steps:
 *   1. Validate owner auth
 *   2. Validate title + file (type, size)
 *   3. Create episode row (draft state)
 *   4. Upload audio buffer to GCS
 *   5. Save audio storage key on the episode
 *   6. Create a cleaned_audio asset pointing to the GCS key
 *   7. Transition episode: draft → processing
 *   8. Schedule background processing via after()
 *   9. Redirect to the episode detail page
 *
 * Returns: never (redirect throws) — errors surface as thrown Error instances.
 */
export async function uploadEpisodeAction(formData: FormData): Promise<never> {
  const { userId } = await requireOwner();

  // ── Validate title ──────────────────────────────────────────────────────────
  const title = z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(255, "Title must be 255 characters or fewer")
    .parse(formData.get("title"));

  // ── Validate audio file ─────────────────────────────────────────────────────
  const audioFile = formData.get("audio");
  if (!(audioFile instanceof File) || audioFile.size === 0) {
    throw new Error("Please select an audio file.");
  }
  if (!ALLOWED_AUDIO_TYPES.has(audioFile.type) && !audioFile.name.match(/\.(mp3|m4a|wav|ogg|flac)$/i)) {
    throw new Error("Unsupported audio format. Use MP3, M4A, WAV, OGG, or FLAC.");
  }
  if (audioFile.size > MAX_AUDIO_BYTES) {
    throw new Error(`Audio file exceeds the 25 MB limit (got ${(audioFile.size / 1024 / 1024).toFixed(1)} MB).`);
  }

  // ── Create episode (draft) ──────────────────────────────────────────────────
  const episode = await episodeService.createEpisode({ title }, userId);
  const episodeId = episode.id;

  // ── Upload audio to GCS ─────────────────────────────────────────────────────
  const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
  const storageKey  = await uploadAudioBuffer(episodeId, audioFile.name, audioBuffer, audioFile.type || "audio/mpeg");

  // ── Persist storage key + create cleaned_audio asset ───────────────────────
  await episodeRepository.setAudioStorageKey(episodeId, storageKey);
  await assetRepository.createAssetVersion({
    episodeId,
    assetType:  "cleaned_audio",
    label:      `Original upload: ${audioFile.name}`,
    storageKey,
    content:    null,
  });

  // Track episode creation (non-blocking)
  trackServerEvent("episode_created", userId, { episodeId });

  // ── Transition: draft → processing ─────────────────────────────────────────
  await executeTransition({
    episodeId,
    ownerId:           userId,
    fromState:         "draft",
    currentFsmVersion: episode.fsmVersion,
    toState:           "processing",
    idempotencyKey:    randomUUID(),
    metadata:          JSON.stringify({ source: "upload-action", filename: audioFile.name }),
  });

  // ── Enqueue persistent job ─────────────────────────────────────────────────
  // Writing the job BEFORE after() means it survives even if the after() trigger
  // fails — the stale-job cron or next upload will pick it up.
  const { enqueueJob } = await import("@/lib/job-queue");
  await enqueueJob("process_episode", { episodeId, ownerId: userId });

  // ── Trigger worker immediately after response is flushed ───────────────────
  // after() fires once the Server Action response reaches the client.
  // The worker claims and runs the enqueued job — it does NOT re-trigger
  // processing directly, so a crash here is safe (job is already in queue).
  const port      = process.env.PORT ?? "3000";
  const workerUrl = `http://localhost:${port}/rpc/queue/worker`;
  const secret    = process.env.CRON_SECRET ?? "";

  after(async () => {
    try {
      const res = await fetch(workerUrl, {
        method:  "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok && res.status !== 204) {
        console.error(JSON.stringify({ event: "episode.worker.trigger_failed", episodeId, status: res.status }));
      }
    } catch (err) {
      console.error(JSON.stringify({ event: "episode.worker.trigger_error", episodeId, error: String(err) }));
    }
  });

  // Redirect to the episode detail page — this throws internally (Next.js redirect)
  redirect(`/dashboard/episodes/${episodeId}`);
}
