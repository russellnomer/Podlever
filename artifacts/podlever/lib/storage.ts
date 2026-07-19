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

/** Singleton GCS client — authenticated via Replit ADC sidecar. */
const storage = new Storage();

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
