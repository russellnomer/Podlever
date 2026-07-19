/**
 * lib/audio-cleanup.ts — Dolby.io Media API audio enhancement
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — close audio cleanup gap)
 *
 * Integrates Dolby.io Media APIs to apply noise reduction, normalization,
 * and loudness leveling to raw podcast audio before asset generation.
 *
 * Cost: ~$0.003/min processed audio (~$0.18/hr). Far cheaper than Auphonic.
 * Free tier: 100 minutes/month included.
 *
 * Config (Replit Secrets):
 *   DOLBY_API_APP_KEY    — Dolby.io application key
 *   DOLBY_API_APP_SECRET — Dolby.io application secret
 *
 * Graceful fallback: if env vars are absent or any step fails, returns null
 * so the pipeline continues with the original audio. A warning is logged.
 *
 * HUMAN REVIEW NOTES:
 * - Input is provided as a pre-signed GCS URL (15-min validity).
 * - Output is stored in Dolby's temporary storage (dlb://out/…) then
 *   downloaded and returned as a Buffer for our GCS upload.
 * - Polling cap: 3 minutes. Episodes > 3 hours may need the cap raised.
 * - SECURITY: server-only — never import from client components.
 */

import "server-only";

const DOLBY_AUTH_URL   = "https://api.dolby.com/auth/v1/token";
const DOLBY_MEDIA_BASE = "https://api.dolby.io/media";

// ─── Types ────────────────────────────────────────────────────────────────────

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
 * Tokens are valid for 30 minutes; we generate one per cleanup call (no cache
 * needed at beta volume). Add caching here when usage grows.
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

// ─── Input upload ─────────────────────────────────────────────────────────────

/**
 * uploadToDolby — Register an audio file URL as Dolby temporary input.
 * Returns the dlb://in/… reference used by the enhance job.
 */
async function uploadToDolby(token: string, signedUrl: string): Promise<string> {
  const dlbInputUrl = `dlb://in/podlever-input-${Date.now()}.wav`;

  const res = await fetch(`${DOLBY_MEDIA_BASE}/input`, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
    body: JSON.stringify({ url: signedUrl }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dolby input registration failed: ${res.status} ${text.slice(0, 200)}`);
  }

  // Dolby input API responds with the dlb:// URL it registered
  const data = await res.json() as { url?: string };
  return data.url ?? dlbInputUrl;
}

// ─── Enhance job ──────────────────────────────────────────────────────────────

/**
 * startEnhanceJob — Submit an audio enhancement job to Dolby.
 * Returns the job_id for polling.
 *
 * Enhance profile "podcast" applies:
 *   - Noise reduction (background hum, fan noise, hiss)
 *   - Speech isolation
 *   - Loudness normalization (-16 LUFS, broadcast standard)
 */
async function startEnhanceJob(
  token:    string,
  inputUrl: string,
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
      content: {
        type: "podcast",     // speech-optimized profile
      },
      audio: {
        noise: { reduction: { enable: true, amount: "auto" } },
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
 * pollJobCompletion — Poll Dolby until the job succeeds or fails.
 * Backs off: 5s → 10s → 15s intervals. Caps at timeoutMs (default 3 min).
 */
async function pollJobCompletion(
  token:     string,
  jobId:     string,
  timeoutMs  = 3 * 60 * 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let interval   = 5_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval + 5_000, 20_000);

    const res = await fetch(`${DOLBY_MEDIA_BASE}/enhance?job_id=${encodeURIComponent(jobId)}`, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });

    if (!res.ok) continue; // transient error — keep polling

    const data = await res.json() as DolbyJobStatus;

    if (data.status === "Success")   return;
    if (data.status === "Failed")    throw new Error(`Dolby job failed: ${data.error?.detail ?? "unknown"}`);
    if (data.status === "Canceled")  throw new Error("Dolby job was canceled");
    // Pending / Running — keep polling
  }

  throw new Error(`Dolby job timed out after ${timeoutMs / 1000}s`);
}

// ─── Output download ──────────────────────────────────────────────────────────

/**
 * downloadDolbyOutput — Download the enhanced audio from Dolby temporary storage.
 */
async function downloadDolbyOutput(token: string, outputUrl: string): Promise<Buffer> {
  const res = await fetch(`${DOLBY_MEDIA_BASE}/output?url=${encodeURIComponent(outputUrl)}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Dolby output download failed: ${res.status}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CleanupResult {
  /** The cleaned audio buffer ready for GCS upload. */
  buffer:   Buffer;
  /** MIME type of the cleaned audio (always WAV from Dolby). */
  mimeType: "audio/wav";
}

/**
 * cleanAudio — Apply Dolby.io noise reduction and normalization to an audio file.
 *
 * Workflow:
 *   1. Exchange credentials for a bearer token
 *   2. Register input URL (GCS signed URL) with Dolby
 *   3. Submit enhance job
 *   4. Poll until complete (max 3 min)
 *   5. Download cleaned audio
 *   6. Return as Buffer
 *
 * @param signedInputUrl  Pre-signed GCS URL for the original audio (15 min TTL)
 * @param episodeId       Used to namespace the Dolby temp storage key
 * @returns               CleanupResult or null if cleanup is unavailable
 *
 * Returns null (with a warning log) if:
 *   - Dolby API credentials are not configured
 *   - Any step fails (network error, job failure, timeout)
 * The caller should fall back to the original audio when null is returned.
 */
export async function cleanAudio(
  signedInputUrl: string,
  episodeId:      string,
): Promise<CleanupResult | null> {
  // Bail out silently if credentials are not configured
  if (!process.env.DOLBY_API_APP_KEY || !process.env.DOLBY_API_APP_SECRET) {
    console.warn(JSON.stringify({
      event:     "audio_cleanup.skipped",
      episodeId,
      reason:    "DOLBY_API_APP_KEY / DOLBY_API_APP_SECRET not set",
    }));
    return null;
  }

  const outputDlbUrl = `dlb://out/podlever-${episodeId}-cleaned.wav`;

  try {
    console.info(JSON.stringify({ event: "audio_cleanup.start", episodeId }));

    const token    = await getDolbyToken();
    const inputUrl = await uploadToDolby(token, signedInputUrl);
    const jobId    = await startEnhanceJob(token, inputUrl, outputDlbUrl);

    console.info(JSON.stringify({ event: "audio_cleanup.job_started", episodeId, jobId }));

    await pollJobCompletion(token, jobId);

    const buffer = await downloadDolbyOutput(token, outputDlbUrl);

    console.info(JSON.stringify({
      event:     "audio_cleanup.complete",
      episodeId,
      bytes:     buffer.byteLength,
    }));

    return { buffer, mimeType: "audio/wav" };

  } catch (err) {
    console.warn(JSON.stringify({
      event:     "audio_cleanup.failed",
      episodeId,
      error:     err instanceof Error ? err.message : String(err),
    }));
    return null; // graceful degradation — caller uses original audio
  }
}
