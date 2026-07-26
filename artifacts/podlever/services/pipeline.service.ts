/**
 * services/pipeline.service.ts — End-to-end episode processing pipeline
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (Phase 1B — pipeline engine)
 *
 * Dependencies:
 *   @/providers/transcription — Deepgram Nova-3
 *   @/providers/writer + @/services/prompts — Claude
 *   @/services (episode + asset services) — persistence + FSM
 *
 * HUMAN REVIEW NOTES:
 * This is the orchestrator that ties the providers to the domain model. It is
 * the concrete implementation of "one recording in, assets out" for the first
 * two outputs (transcript + show notes). The remaining outputs (cleaned_audio,
 * youtube_cut, vertical_clip, blog_post, social_post, guest_media_pack) plug in
 * here as additional steps, each following the same pattern:
 *   run provider → persist asset (content or storageKey) → continue.
 *
 * FSM discipline: the pipeline owns the draft → processing → ready transitions.
 * Idempotency keys are derived from a per-run id so a retried run does not
 * double-emit pipeline events (see @/db/schema/pipeline-events).
 *
 * Context-agnostic, like the other services: it receives ownerId from the caller
 * (a Server Action after requireOwner()) and never reads request context itself.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import { transcribeAudio, type AudioMimeType } from "@/providers/transcription";
import { write } from "@/providers/writer";
import { showNotesPrompt, socialPostsPrompt } from "@/services/prompts";
import { assetService } from "@/services/asset.service";
import { episodeService } from "@/services/episode.service";
import type { Asset, Episode } from "@/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProcessRecordingInput = {
  /** Episode being processed. Must be in "draft" (or "ready", for re-process). */
  episodeId: string;
  /** DB user id of the authenticated owner (from requireOwner()). */
  ownerId: string;
  /** Raw audio bytes of the uploaded recording. */
  audio: Uint8Array;
  /** MIME type of the audio (defaults to audio/mpeg). */
  mimeType?: AudioMimeType;
};

export type ProcessRecordingResult = {
  episode: Episode;
  transcript: {
    asset: Asset;
    confidence: number;
    durationSeconds: number;
  };
  showNotes: {
    asset: Asset;
    model: string;
  };
  socialPosts: {
    asset: Asset;
    model: string;
  };
};

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when the pipeline cannot complete a run. Wraps the underlying cause. */
export class PipelineError extends Error {
  constructor(
    message: string,
    /** The step that failed, for logging/telemetry. */
    public readonly step: "transcription" | "show_notes" | "social_posts" | "fsm" | "persistence",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

// ─── Service ────────────────────────────────────────────────────────────────────

/**
 * PipelineService — orchestrates a full processing run for one recording.
 */
export class PipelineService {
  /**
   * processRecording — Transcribe an uploaded recording and generate show notes.
   *
   * Flow:
   *   1. Move episode draft → processing (idempotent).
   *   2. Deepgram transcription → persist `transcript` asset (content = text).
   *   3. Claude show notes → persist `show_notes` asset (content = markdown).
   *   4. Move episode processing → ready.
   *
   * @throws {PipelineError} with the failing step attached.
   */
  async processRecording(input: ProcessRecordingInput): Promise<ProcessRecordingResult> {
    const { episodeId, ownerId, audio } = input;
    const mimeType = input.mimeType ?? "audio/mpeg";
    const runId = randomUUID();

    // Fetch current episode to read its fsm_version and title (also asserts ownership).
    let episode = await episodeService.getEpisode(episodeId, ownerId);

    // ── Step 1: draft → processing ───────────────────────────────────────────
    if (episode.state === "draft" || episode.state === "ready") {
      try {
        const t = await episodeService.transitionEpisode(
          {
            episodeId,
            currentFsmVersion: episode.fsmVersion,
            toState: "processing",
            idempotencyKey: `${runId}:processing`,
            metadata: JSON.stringify({ runId, trigger: "processRecording" }),
          },
          ownerId,
        );
        episode = t.episode;
      } catch (cause) {
        throw new PipelineError("Failed to enter processing state", "fsm", cause);
      }
    }

    // ── Step 2: transcription ──────────────────────────────────────────────────
    let transcriptText: string;
    let confidence: number;
    let durationSeconds: number;
    try {
      const result = await transcribeAudio(audio, mimeType);
      transcriptText = result.text;
      confidence = result.confidence;
      durationSeconds = result.durationSeconds;
    } catch (cause) {
      throw new PipelineError("Transcription failed", "transcription", cause);
    }

    if (!transcriptText.trim()) {
      throw new PipelineError(
        "Transcription returned empty text — recording may be silent or unsupported",
        "transcription",
      );
    }

    let transcriptAsset: Asset;
    try {
      transcriptAsset = await assetService.createAssetVersion(
        {
          episodeId,
          assetType: "transcript",
          label: `Transcript (${durationSeconds.toFixed(0)}s, confidence ${confidence.toFixed(2)})`,
          content: transcriptText,
        },
        ownerId,
      );
    } catch (cause) {
      throw new PipelineError("Failed to persist transcript", "persistence", cause);
    }

    // ── Step 3: show notes ──────────────────────────────────────────────────────
    let showNotesText: string;
    let writerModel: string;
    try {
      const { system, user } = showNotesPrompt(transcriptText, episode.title);
      const result = await write({ system, user, maxTokens: 1500 });
      showNotesText = result.text;
      writerModel = result.model;
    } catch (cause) {
      throw new PipelineError("Show-notes generation failed", "show_notes", cause);
    }

    let showNotesAsset: Asset;
    try {
      showNotesAsset = await assetService.createAssetVersion(
        {
          episodeId,
          assetType: "show_notes",
          label: `Show notes (${writerModel})`,
          content: showNotesText,
        },
        ownerId,
      );
    } catch (cause) {
      throw new PipelineError("Failed to persist show notes", "persistence", cause);
    }

    // ── Step 3b: social posts ────────────────────────────────────────────────────
    let socialText: string;
    let socialModel: string;
    try {
      const { system, user } = socialPostsPrompt(transcriptText, episode.title);
      const result = await write({ system, user, maxTokens: 1200 });
      socialText = result.text;
      socialModel = result.model;
    } catch (cause) {
      throw new PipelineError("Social-posts generation failed", "social_posts", cause);
    }

    let socialAsset: Asset;
    try {
      socialAsset = await assetService.createAssetVersion(
        {
          episodeId,
          assetType: "social_post",
          label: `Social pack (${socialModel})`,
          content: socialText,
        },
        ownerId,
      );
    } catch (cause) {
      throw new PipelineError("Failed to persist social posts", "persistence", cause);
    }

    // ── Step 4: processing → ready ───────────────────────────────────────────────
    try {
      const t = await episodeService.transitionEpisode(
        {
          episodeId,
          currentFsmVersion: episode.fsmVersion,
          toState: "ready",
          idempotencyKey: `${runId}:ready`,
          metadata: JSON.stringify({ runId, assets: ["transcript", "show_notes", "social_post"] }),
        },
        ownerId,
      );
      episode = t.episode;
    } catch (cause) {
      throw new PipelineError("Failed to enter ready state", "fsm", cause);
    }

    return {
      episode,
      transcript: { asset: transcriptAsset, confidence, durationSeconds },
      showNotes: { asset: showNotesAsset, model: writerModel },
      socialPosts: { asset: socialAsset, model: socialModel },
    };
  }
}

/** pipelineService — singleton service instance. */
export const pipelineService = new PipelineService();
