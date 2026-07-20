/**
 * lib/audio/providers/dolby.ts — Dolby.io Media API audio enhancement provider
 *
 * Part of: PodLever
 * Created: 2026-07-20 by agent (Board move 1 — refactored from lib/audio-cleanup.ts)
 *
 * Applies Dolby's podcast enhancement profile: noise reduction, speech isolation,
 * and loudness normalization (-16 LUFS). Higher quality than FFmpeg on challenging
 * recordings (multiple speakers, noisy environments, poor mic placement).
 *
 * Config (Replit Secrets):
 *   DOLBY_API_APP_KEY    — Dolby.io application key (from dashboard.dolby.io)
 *   DOLBY_API_APP_SECRET — Dolby.io application secret
 *
 * Cost: ~$0.003/min processed audio.
 * Free tier: 100 minutes/month included on new accounts.
 *
 * Change from audio-cleanup.ts:
 *   - Input is now a Buffer (direct upload to Dolby via PUT) instead of a
 *     signed GCS URL. This removes the dependency on GCS signed URL generation
 *     and makes the provider usable in any context, not just GCS-backed episodes.
 *
 * SECURITY: server-only — never import from client components.
 */

import "server-only";

import type { AudioProvider, EnhancementResult } from "../types";

const DOLBY_AUTH_URL   = "https://api.dolby.com/auth/v1/token";
const DOLBY_MEDIA_BASE = "https://api.dolby.io/media";

// ─── Internal types ───────────────────────────────────────────────────────────

interface DolbyToken {
  access_token: string;
  expires_in:   number;
  token_type:   string;
}

interface DolbyJobStatus {
  status:   "Pending" | "Running" | "Success" | "Failed" | "Canceled";
  progress: number;
  error?:   { title: string; detail: string };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * getDolbyToken — Exchange app credentials for a short-lived bearer token.
 * Valid for 30 minutes; one per request is fine at beta volume.
 */
async function getDolbyToken(): Promise<string> {
  const key    = process.env.DOLBY_API_APP_KEY;
  const secret = process.env.DOLBY_API_APP_SECRET;
  if (!key || !secret) {
    throw new Error("DOLBY_API_APP_KEY / DOLBY_API_APP_SECRET not configured");
  }

  const credentials = Buffer.from(`${key}:${secret}`).toString("base64");

  const res = await fetch(DOLBY_AUTH_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type":  "application/x-www-form-urlencoded",
      "Accept":        "application/json",
    },
    body: "grant_type=client_credentials&expires_in=1800",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dolby auth failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json() as DolbyToken;
  return data.access_token;
}

// ─── Direct upload ────────────────────────────────────────────────────────────

/**
 * uploadBufferToDolby — PUT audio bytes directly to Dolby temporary storage.
 *
 * Unlike the previous signed-URL approach, this uploads the buffer directly.
 * Dolby accepts any audio format their media processor supports.
 * Returns the dlb://in/… reference used by the enhance job.
 */
async function uploadBufferToDolby(
  token:      string,
  buffer:     Buffer,
  mimeType:   string,
  episodeId:  string,
): Promise<string> {
  // Dolby temporary input URL — namespaced per episode to avoid collisions
  const dlbInputUrl = `dlb://in/podlever-${episodeId}-input`;

  const res = await fetch(
    `${DOLBY_MEDIA_BASE}/input?url=${encodeURIComponent(dlbInputUrl)}`,
    {
      method:  "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  mimeType,
        "Content-Length": String(buffer.byteLength),
      },
      body: new Uint8Array(buffer),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dolby input upload failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return dlbInputUrl;
}

// ─── Enhance job ──────────────────────────────────────────────────────────────

/**
 * startEnhanceJob — Submit an audio enhancement job.
 * Returns the job_id for polling.
 *
 * Profile "podcast":
 *   - Noise reduction (fan noise, HVAC, hiss)
 *   - Speech isolation
 *   - Loudness normalization (-16 LUFS, broadcast standard)
 */
async function startEnhanceJob(
  token:     string,
  inputUrl:  string,
  outputUrl: string,
): Promise<string> {
  const res = await fetch(`${DOLBY_MEDIA_BASE}/enhance`, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
    body: JSON.stringify({
      input:  inputUrl,
      output: outputUrl,
      content: { type: "podcast" },
      audio: {
        noise:    { reduction: { enable: true, amount: "auto" } },
        loudness: { enable: true, dialog_intelligence: true },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dolby enhance job failed to start: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { job_id?: string };
  if (!data.job_id) throw new Error("Dolby enhance: no job_id in response");
  return data.job_id;
}

// ─── Polling ──────────────────────────────────────────────────────────────────

/**
 * pollJobCompletion — Poll until success, failure, or timeout (default 5 min).
 * Backoff: 5s → 10s → 20s intervals.
 */
async function pollJobCompletion(
  token:     string,
  jobId:     string,
  timeoutMs  = 5 * 60 * 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let   interval = 5_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval + 5_000, 20_000);

    const res = await fetch(
      `${DOLBY_MEDIA_BASE}/enhance?job_id=${encodeURIComponent(jobId)}`,
      { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" } },
    );

    if (!res.ok) continue; // transient error — keep polling

    const data = await res.json() as DolbyJobStatus;
    if (data.status === "Success")  return;
    if (data.status === "Failed")   throw new Error(`Dolby job failed: ${data.error?.detail ?? "unknown"}`);
    if (data.status === "Canceled") throw new Error("Dolby job was canceled");
    // Pending / Running — keep polling
  }

  throw new Error(`Dolby job timed out after ${timeoutMs / 1_000}s`);
}

// ─── Output download ──────────────────────────────────────────────────────────

async function downloadDolbyOutput(token: string, outputUrl: string): Promise<Buffer> {
  const res = await fetch(
    `${DOLBY_MEDIA_BASE}/output?url=${encodeURIComponent(outputUrl)}`,
    { headers: { "Authorization": `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(`Dolby output download failed: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ─── Provider ─────────────────────────────────────────────────────────────────

class DolbyProvider implements AudioProvider {
  readonly name = "dolby";

  /** Available only when both API credentials are set. */
  isAvailable(): boolean {
    return !!(process.env.DOLBY_API_APP_KEY && process.env.DOLBY_API_APP_SECRET);
  }

  async enhance(
    input:         Buffer,
    inputMimeType: string,
    episodeId:     string,
  ): Promise<EnhancementResult> {
    const outputDlbUrl = `dlb://out/podlever-${episodeId}-cleaned.wav`;

    const token    = await getDolbyToken();
    const inputUrl = await uploadBufferToDolby(token, input, inputMimeType, episodeId);
    const jobId    = await startEnhanceJob(token, inputUrl, outputDlbUrl);

    console.info(JSON.stringify({ event: "audio.dolby.job_started", episodeId, jobId }));

    await pollJobCompletion(token, jobId);

    const buffer = await downloadDolbyOutput(token, outputDlbUrl);

    return { buffer, mimeType: "audio/wav", provider: this.name };
  }
}

export const dolbyProvider: AudioProvider = new DolbyProvider();
