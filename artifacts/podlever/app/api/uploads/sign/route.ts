/**
 * app/api/uploads/sign/route.ts — Mint a signed direct-upload URL
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (large uploads — remove the 25 MB wall)
 *
 * POST /api/uploads/sign   { filename, contentType, sizeBytes }
 *   → { uploadUrl, storageKey, token }
 *
 * Real podcast episodes are 50–150 MB (and video recordings more), far past
 * what should flow through the web server. This endpoint lets the browser
 * upload straight to GCS with a signed PUT URL; the server never touches the
 * bytes. The client then calls finalizeDirectUploadAction with the returned
 * storageKey + token to create the episode.
 *
 * SECURITY:
 * - Auth: beta users/owner only (same guard as the upload action).
 * - The storage key is server-generated (UUID) — clients can't choose paths.
 * - `token` is an HMAC over userId:storageKey (SESSION_SECRET). The finalize
 *   action verifies it, so users can't claim objects they didn't get signed.
 * - Size/type are validated here for UX, and re-verified against the actual
 *   GCS object at finalize time (the authoritative check).
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID }                     from "crypto";
import { requireBetaUser }                from "@/providers/owner-guard";
import { signUploadToken }                from "@/lib/upload-token";
import { ensureUploadCors, getSignedUploadUrl } from "@/lib/storage";

/** Max direct-upload size — generous enough for multi-hour video recordings. */
const MAX_DIRECT_UPLOAD_BYTES = 300 * 1024 * 1024;

/** Extensions we can process (audio directly; video via FFmpeg extraction). */
const ALLOWED_EXTENSIONS = new Set([
  "mp3", "m4a", "wav", "ogg", "flac",       // audio
  "mp4", "mov", "webm", "m4v", "mpeg", "mpg", // video (audio track extracted)
]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    ({ userId } = await requireBetaUser());
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  let body: { filename?: unknown; contentType?: unknown; sizeBytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filename    = typeof body.filename === "string" ? body.filename : "";
  const contentType = typeof body.contentType === "string" && body.contentType
    ? body.contentType
    : "application/octet-stream";
  const sizeBytes   = typeof body.sizeBytes === "number" ? body.sizeBytes : 0;

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: "Unsupported format. Use MP3, M4A, WAV, OGG, FLAC, MP4, MOV, or WEBM." },
      { status: 400 },
    );
  }
  if (!sizeBytes || sizeBytes <= 0) {
    return NextResponse.json({ error: "Missing file size" }, { status: 400 });
  }
  if (sizeBytes > MAX_DIRECT_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File is too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Max is ${MAX_DIRECT_UPLOAD_BYTES / 1024 / 1024} MB.` },
      { status: 400 },
    );
  }

  // Make sure the bucket accepts browser PUTs (no-op after first success).
  await ensureUploadCors();

  const storageKey = `audio/direct/${randomUUID()}/original.${ext}`;
  const uploadUrl  = await getSignedUploadUrl(storageKey, contentType);
  const token      = signUploadToken(userId, storageKey);

  return NextResponse.json({ uploadUrl, storageKey, token });
}
