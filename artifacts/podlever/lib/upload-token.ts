/**
 * lib/upload-token.ts — HMAC tokens binding a direct-upload storage key to a user
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (large uploads — remove the 25 MB wall)
 *
 * The sign route mints `hmac(userId:storageKey)`; the finalize action verifies
 * it. This prevents a user from claiming a GCS object they weren't issued
 * (e.g. another user's upload) without needing a DB table for pending uploads.
 *
 * SECURITY: server-only. Uses SESSION_SECRET as the HMAC key.
 */

import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/** Sign a storage key for a specific user. */
export function signUploadToken(userId: string, storageKey: string): string {
  const secret = process.env.SESSION_SECRET ?? "";
  return createHmac("sha256", secret).update(`${userId}:${storageKey}`).digest("hex");
}

/** Constant-time verification of an upload token. */
export function verifyUploadToken(userId: string, storageKey: string, token: string): boolean {
  const expected = signUploadToken(userId, storageKey);
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}
