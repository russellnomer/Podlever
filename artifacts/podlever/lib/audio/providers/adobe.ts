/**
 * lib/audio/providers/adobe.ts — Adobe Podcast Enhance API provider
 *
 * Part of: PodLever
 * Created: 2026-07-20 by agent (Board move 2 — Adobe Podcast Enhance)
 *
 * Integrates Adobe's Speech Enhancer API (podcast.adobe.com/enhance).
 * Currently free in beta. Quality is comparable to Dolby — excellent on
 * speech-focused audio. Adobe's model is specifically trained on podcast
 * and voice recording content.
 *
 * Config (Replit Secrets):
 *   ADOBE_ENHANCE_API_KEY — API key from the Adobe Podcast Enhance developer portal
 *
 * API flow:
 *   1. POST /v1/enhance — upload audio (multipart), receive jobId
 *   2. GET  /v1/enhance/{jobId} — poll until status === "succeeded"
 *   3. GET  /v1/enhance/{jobId}/download — stream enhanced audio bytes
 *
 * Cost: Free (as of 2026-07 beta). May introduce pricing later.
 *
 * SECURITY: server-only — never import from client components.
 */

import "server-only";

import type { AudioProvider, EnhancementResult } from "../types";

const ADOBE_API_BASE = "https://podcast.adobe.com/api/v1";

// ─── Internal types ───────────────────────────────────────────────────────────

interface AdobeJobResponse {
  jobId:  string;
  status?: string;
}

interface AdobeJobStatus {
  jobId:  string;
  status: "queued" | "processing" | "succeeded" | "failed";
  error?: string;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * submitEnhanceJob — Upload audio and start an enhance job.
 * Returns the job ID for polling.
 *
 * Adobe's API accepts multipart/form-data with a "file" field.
 * Supported input formats: MP3, WAV, M4A, AAC, OGG, FLAC.
 */
async function submitEnhanceJob(
  apiKey:   string,
  buffer:   Buffer,
  mimeType: string,
  episodeId: string,
): Promise<string> {
  // Build a multipart form body using the native FormData API
  const form = new FormData();
  // Convert Buffer → Uint8Array so Blob accepts it in all TS targets
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  form.append("file", blob, `episode-${episodeId}.audio`);

  const res = await fetch(`${ADOBE_API_BASE}/enhance`, {
    method:  "POST",
    headers: { "x-api-key": apiKey },
    body:    form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Adobe enhance submit failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json() as AdobeJobResponse;
  if (!data.jobId) throw new Error("Adobe enhance: no jobId in response");
  return data.jobId;
}

// ─── Polling ──────────────────────────────────────────────────────────────────

/**
 * pollAdobeJob — Poll until the job succeeds, fails, or times out.
 * Backoff: 5s → 15s intervals. Default timeout: 5 minutes.
 */
async function pollAdobeJob(
  apiKey:    string,
  jobId:     string,
  timeoutMs  = 5 * 60 * 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let   interval = 5_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval + 5_000, 15_000);

    const res = await fetch(`${ADOBE_API_BASE}/enhance/${encodeURIComponent(jobId)}`, {
      headers: { "x-api-key": apiKey, "Accept": "application/json" },
    });

    if (!res.ok) continue; // transient — keep polling

    const data = await res.json() as AdobeJobStatus;

    if (data.status === "succeeded") return;
    if (data.status === "failed") {
      throw new Error(`Adobe enhance job failed: ${data.error ?? "unknown reason"}`);
    }
    // queued / processing — keep polling
  }

  throw new Error(`Adobe enhance job timed out after ${timeoutMs / 1_000}s`);
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function downloadAdobeResult(apiKey: string, jobId: string): Promise<Buffer> {
  const res = await fetch(
    `${ADOBE_API_BASE}/enhance/${encodeURIComponent(jobId)}/download`,
    { headers: { "x-api-key": apiKey } },
  );

  if (!res.ok) {
    throw new Error(`Adobe enhance download failed: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ─── Provider ─────────────────────────────────────────────────────────────────

class AdobeProvider implements AudioProvider {
  readonly name = "adobe";

  /** Available only when ADOBE_ENHANCE_API_KEY is set. */
  isAvailable(): boolean {
    return !!process.env.ADOBE_ENHANCE_API_KEY;
  }

  async enhance(
    input:         Buffer,
    inputMimeType: string,
    episodeId:     string,
  ): Promise<EnhancementResult> {
    const apiKey = process.env.ADOBE_ENHANCE_API_KEY!;

    const jobId = await submitEnhanceJob(apiKey, input, inputMimeType, episodeId);

    console.info(JSON.stringify({ event: "audio.adobe.job_started", episodeId, jobId }));

    await pollAdobeJob(apiKey, jobId);

    const buffer = await downloadAdobeResult(apiKey, jobId);

    return { buffer, mimeType: "audio/wav", provider: this.name };
  }
}

export const adobeProvider: AudioProvider = new AdobeProvider();
