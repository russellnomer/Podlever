/**
 * lib/storage.ts — Google Cloud Storage client for PodLever
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #2 — Episode processing pipeline)
 *
 * Dependencies: @google-cloud/storage (Replit sidecar provides credentials via ADC)
 *
 * HUMAN REVIEW NOTES:
 * Replit provisions a GCS bucket via object storage and injects credentials
 * through Application Default Credentials (ADC) in the environment sidecar.
 * No explicit key file is needed — new Storage() picks up ADC automatically.
 *
 * All audio files are stored under: audio/{episodeId}/original.{ext}
 * The bucket ID comes from the DEFAULT_OBJECT_STORAGE_BUCKET_ID secret.
 *
 * SECURITY: This module is server-only. Never import from client components.
 */

import "server-only";
import { Storage } from "@google-cloud/storage";

/**
 * Replit's local credential/signing service ("sidecar"). Replit-provisioned
 * buckets are accessed with token-based (external account) credentials served
 * from this endpoint — there is NO service-account private key available, so
 * the generic GCS auth/signing paths don't work in Replit deployments.
 */
const REPLIT_SIDECAR_ENDPOINT = process.env.REPLIT_SIDECAR_ENDPOINT ?? "http://127.0.0.1:1106";

/** Running on Replit (workspace or deployment)? The sidecar only exists there. */
const ON_REPLIT = Boolean(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT);

/**
 * Singleton GCS client. On Replit: external-account credentials from the
 * sidecar (the pattern Replit's own object-storage blueprint uses). Elsewhere
 * (local dev/CI): plain ADC.
 */
const storage = ON_REPLIT
  ? new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: { type: "json", subject_token_field_name: "access_token" },
        },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    })
  : new Storage();

/** Returns the provisioned GCS bucket. Throws if env var is missing. */
function getBucket() {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return storage.bucket(bucketId);
}

/**
 * uploadAudioBuffer — Save a raw audio buffer to GCS.
 *
 * @param episodeId   UUID of the parent episode (used to namespace the path)
 * @param filename    Original filename (e.g. "interview.mp3") — extension preserved
 * @param buffer      Raw audio bytes
 * @param mimeType    Content-Type (e.g. "audio/mpeg", "audio/mp4", "audio/wav")
 * @returns           The GCS object name (storage key), e.g. "audio/{id}/original.mp3"
 *
 * Business context: Called during episode upload. The returned storageKey is saved
 * on the episode row and used later by the processing pipeline to fetch the audio.
 */
export async function uploadAudioBuffer(
  episodeId: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  // Derive extension from the original filename for human-readable paths
  const ext = filename.split(".").pop()?.toLowerCase() ?? "mp3";
  const objectName = `audio/${episodeId}/original.${ext}`;

  const bucket = getBucket();
  const file = bucket.file(objectName);

  // save() uploads the buffer as a single request (suitable for files up to ~100MB)
  await file.save(buffer, {
    metadata: { contentType: mimeType },
    resumable: false, // disable resumable upload for smaller files (faster)
  });

  return objectName;
}

/**
 * downloadAudioBuffer — Fetch a GCS audio object as a Buffer.
 *
 * @param storageKey  GCS object name returned by uploadAudioBuffer
 * @returns           The raw audio bytes as a Node.js Buffer
 *
 * Business context: Called by the processing pipeline to load audio before
 * sending to OpenAI Whisper for transcription.
 */
export async function downloadAudioBuffer(storageKey: string): Promise<Buffer> {
  const bucket = getBucket();
  const [contents] = await bucket.file(storageKey).download();
  return contents;
}

/**
 * uploadFileBuffer — Upload any file buffer to GCS at an explicit storage key.
 *
 * Unlike uploadAudioBuffer (which derives the path from episodeId + filename),
 * this accepts the full storage key directly. Used for PDFs, cleaned audio, and
 * other generated files where the caller controls the path.
 *
 * @param storageKey  Full GCS object name (e.g. "pdfs/{episodeId}/guest-pack.pdf")
 * @param buffer      Raw file bytes
 * @param mimeType    Content-Type (e.g. "application/pdf", "audio/wav")
 * @returns           The storageKey (passed through for convenience)
 */
export async function uploadFileBuffer(
  storageKey: string,
  buffer:     Buffer,
  mimeType:   string,
): Promise<string> {
  const bucket = getBucket();
  const file   = bucket.file(storageKey);

  await file.save(buffer, {
    metadata:  { contentType: mimeType },
    resumable: false,
  });

  return storageKey;
}

/**
 * getSignedDownloadUrl — Generate a short-lived signed URL for downloading a GCS object.
 *
 * @param storageKey  GCS object name
 * @param expiresMs   URL lifetime in milliseconds (default: 15 minutes)
 * @returns           HTTPS signed URL usable directly by the browser
 *
 * Business context: Used to serve audio download links on the episode detail page.
 * Signed URLs avoid making the bucket public while still allowing browser downloads.
 */
export async function getSignedDownloadUrl(
  storageKey: string,
  expiresMs = 15 * 60 * 1000,
): Promise<string> {
  const bucket = getBucket();
  const [url] = await bucket.file(storageKey).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresMs,
  });
  return url;
}

/**
 * ensureUploadCors — Make sure the bucket accepts browser PUTs (direct upload).
 *
 * Direct-to-GCS uploads bypass the web server entirely (no request-size
 * limits, no server memory pressure), but the browser needs the bucket to
 * answer CORS preflight for PUT. This sets a minimal CORS rule once per
 * process; failures are logged and swallowed — callers fall back to the
 * legacy server-action upload for small files.
 */
let corsEnsured = false;
export async function ensureUploadCors(): Promise<void> {
  if (corsEnsured) return;
  try {
    const bucket = getBucket();
    await bucket.setCorsConfiguration([
      {
        origin:         ["*"],
        method:         ["PUT", "GET", "HEAD"],
        responseHeader: ["Content-Type"],
        maxAgeSeconds:  3600,
      },
    ]);
    corsEnsured = true;
  } catch (err) {
    console.warn(JSON.stringify({
      event: "storage.cors.setup_failed",
      error: (err as Error).message,
    }));
  }
}

/**
 * getSignedUploadUrl — Generate a short-lived signed URL for a direct browser
 * PUT to GCS. The client must send the exact Content-Type used here.
 *
 * @param storageKey   Full GCS object name (server-generated, never client-chosen)
 * @param contentType  MIME type the browser will send
 * @param expiresMs    URL lifetime (default 30 minutes — enough for slow links)
 */
export async function getSignedUploadUrl(
  storageKey:  string,
  contentType: string,
  expiresMs = 30 * 60 * 1000,
): Promise<string> {
  const bucket = getBucket();

  // On Replit, URL signing MUST go through the sidecar: the token-based
  // credentials have no private key, so the GCS client's V4 signing produces
  // signatures Google rejects with 403. The sidecar signs on Replit's side.
  if (ON_REPLIT) {
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucket.name,
        object_name: storageKey,
        method:      "PUT",
        expires_at:  new Date(Date.now() + expiresMs).toISOString(),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Failed to sign upload URL (sidecar ${response.status}): ${detail.slice(0, 200)}`);
    }
    const { signed_url: signedUrl } = (await response.json()) as { signed_url?: string };
    if (!signedUrl) throw new Error("Sidecar returned no signed_url");
    return signedUrl;
  }

  const [url] = await bucket.file(storageKey).getSignedUrl({
    version:     "v4",
    action:      "write",
    expires:     Date.now() + expiresMs,
    contentType,
  });
  return url;
}

/**
 * getObjectSize — Return an uploaded object's size in bytes, or null if it
 * doesn't exist. Used by the finalize action to verify a direct upload
 * actually landed and respects the size cap.
 */
export async function getObjectSize(storageKey: string): Promise<number | null> {
  try {
    const [metadata] = await getBucket().file(storageKey).getMetadata();
    const size = Number(metadata.size);
    return Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
}

/**
 * readObjectHead — Fetch the first `maxBytes` of a GCS object (ranged read).
 *
 * Used by finalizeDirectUploadAction for magic-byte content sniffing without
 * downloading a potentially 300MB file. Returns null if the object is missing
 * or the read fails.
 *
 * Added: 2026-07-27 (Security sprint — PR #22)
 */
export async function readObjectHead(storageKey: string, maxBytes = 64): Promise<Buffer | null> {
  try {
    const [contents] = await getBucket()
      .file(storageKey)
      .download({ start: 0, end: maxBytes - 1 });
    return contents;
  } catch {
    return null;
  }
}
