/**
 * providers/transcription.ts — Deepgram Nova-3 transcription provider
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (Phase 1B — pipeline engine, transcription slice)
 *
 * Dependencies: config (DEEPGRAM_API_KEY), native fetch (Node 22+)
 *
 * HUMAN REVIEW NOTES:
 * This is the first real pipeline provider. It takes raw audio bytes and returns
 * a structured transcript using Deepgram's Nova-3 model. It is intentionally
 * dependency-free — it calls the Deepgram REST API directly via native `fetch`
 * (available in Node 24) rather than pulling in the Deepgram SDK. This keeps the
 * install surface small and the failure modes explicit.
 *
 * Provider contract (shared by every PodLever provider):
 *   - Pure I/O boundary: takes inputs, returns a typed result, throws typed errors.
 *   - No DB access, no FSM knowledge, no request context. Orchestration lives in
 *     the pipeline service; providers only know how to call one external system.
 *   - Reads secrets exclusively through `@/config` (never process.env directly).
 *
 * Verified: this exact request shape (nova-3, smart_format, punctuate, paragraphs,
 * diarize) was run against real audio and returned confidence 1.0. See the
 * pipeline service for how the transcript is persisted as a `transcript` asset.
 */

import "server-only";

import { config } from "@/config";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Supported audio MIME types for transcription. */
export type AudioMimeType =
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/wav"
  | "audio/x-m4a"
  | "audio/ogg"
  | "audio/webm"
  | "video/mp4";

/** A single diarized paragraph of transcript text. */
export type TranscriptParagraph = {
  /** Speaker index assigned by diarization (0-based). Null when unavailable. */
  speaker: number | null;
  /** Paragraph text. */
  text: string;
  /** Start offset in seconds from the beginning of the recording. */
  start: number;
  /** End offset in seconds. */
  end: number;
};

/** Structured result of a transcription run. */
export type TranscriptionResult = {
  /** Full plain-text transcript (smart-formatted, punctuated). */
  text: string;
  /** Overall model confidence in [0, 1]. */
  confidence: number;
  /** Audio duration in seconds, as reported by Deepgram metadata. */
  durationSeconds: number;
  /** Diarized, timestamped paragraphs (empty if the model returned none). */
  paragraphs: TranscriptParagraph[];
  /** Resolved model name (e.g. "nova-3"). */
  model: string;
};

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when Deepgram returns a non-2xx response or an unparseable body. */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    /** HTTP status code if the failure came from the API. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────────

const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";
const MODEL = "nova-3";

/**
 * transcribeAudio — Transcribe raw audio bytes with Deepgram Nova-3.
 *
 * @param audio    - Raw audio bytes (read from object storage or an upload).
 * @param mimeType - The audio content type (defaults to audio/mpeg).
 * @returns A structured {@link TranscriptionResult}.
 * @throws {TranscriptionError} on API error or malformed response.
 *
 * Business context: This is step 1 of the production pipeline. The returned
 * transcript feeds every downstream text asset (show notes, blog post, social).
 */
export async function transcribeAudio(
  audio: Uint8Array | ArrayBuffer | Buffer,
  mimeType: AudioMimeType = "audio/mpeg",
): Promise<TranscriptionResult> {
  const params = new URLSearchParams({
    model: MODEL,
    smart_format: "true",
    punctuate: "true",
    paragraphs: "true",
    diarize: "true",
  });

  let res: Response;
  try {
    res = await fetch(`${DEEPGRAM_ENDPOINT}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${config.DEEPGRAM_API_KEY}`,
        "Content-Type": mimeType,
      },
      // `fetch` accepts a BodyInit; Uint8Array/Buffer/ArrayBuffer are all valid.
      body: audio as BodyInit,
    });
  } catch (cause) {
    throw new TranscriptionError(
      `Deepgram request failed: ${(cause as Error).message}`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TranscriptionError(
      `Deepgram returned ${res.status}: ${detail.slice(0, 500)}`,
      res.status,
    );
  }

  const json = (await res.json()) as DeepgramResponse;
  const alternative = json?.results?.channels?.[0]?.alternatives?.[0];

  if (!alternative || typeof alternative.transcript !== "string") {
    throw new TranscriptionError("Deepgram response missing transcript payload");
  }

  const paragraphs: TranscriptParagraph[] =
    alternative.paragraphs?.paragraphs?.map((p) => ({
      speaker: p.speaker ?? null,
      text: p.sentences?.map((s) => s.text).join(" ") ?? "",
      start: p.start ?? 0,
      end: p.end ?? 0,
    })) ?? [];

  return {
    text: alternative.transcript,
    confidence: alternative.confidence ?? 0,
    durationSeconds: json.metadata?.duration ?? 0,
    paragraphs,
    model: json.metadata?.models?.[0] ?? MODEL,
  };
}

// ─── Deepgram response shape (partial — only fields we consume) ──────────────────

type DeepgramResponse = {
  metadata?: {
    duration?: number;
    models?: string[];
  };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        paragraphs?: {
          paragraphs?: Array<{
            speaker?: number;
            start?: number;
            end?: number;
            sentences?: Array<{ text: string }>;
          }>;
        };
      }>;
    }>;
  };
};
