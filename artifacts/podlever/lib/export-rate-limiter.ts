/**
 * lib/export-rate-limiter.ts — Singleton export rate limiter for the CRM
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — CRM export rate limiting)
 *
 * Exported as a plain module (NOT a Server Action file) so it can be imported
 * by both crm.actions.ts and the /rpc/crm/export Route Handler without
 * triggering Next.js's "all exports must be async" constraint on "use server" files.
 *
 * The same singleton instance is used by both the Server Action (peek/checkExportLimit)
 * and the Route Handler (consumeExportSlot), ensuring the in-memory rate limit
 * state is shared correctly within a single Node.js process.
 *
 * Rate limit: 3 exports per rolling 60-minute window per owner userId.
 * Keyed by userId (not IP) since the export is an authenticated action.
 */

import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";

/**
 * exportRateLimiter — module-level singleton.
 *
 * In-memory; state is lost on process restart (acceptable — limits reset cleanly).
 * Keyed by the owner's DB UUID so the limit is per-user, not per-IP.
 */
export const exportRateLimiter = new SlidingWindowRateLimiter({
  max:      3,
  windowMs: 60 * 60 * 1_000, // 60-minute sliding window
});

/**
 * consumeExportSlot — Record an export hit in the rate limiter.
 *
 * Called exclusively by the Route Handler AFTER authentication and BEFORE
 * streaming the response. Returns whether the export is allowed.
 *
 * @param userId — The owner's DB UUID (used as the rate limit key)
 * @returns { allowed, remaining } — whether the slot was granted + slots left
 */
export function consumeExportSlot(
  userId: string,
): { allowed: boolean; remaining: number } {
  const result = exportRateLimiter.check(userId);
  return { allowed: result.allowed, remaining: Math.max(0, result.remaining) };
}
