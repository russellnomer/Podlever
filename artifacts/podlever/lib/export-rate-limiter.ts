/**
 * lib/export-rate-limiter.ts — Singleton export rate limiter for the CRM
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — CRM export rate limiting)
 * Last modified: 2026-07-19 by agent (Task #38 — switched to PostgresRateLimitStore
 *   so the 3/hr cap survives server restarts and Replit deployment cycles)
 *
 * Exported as a plain module (NOT a Server Action file) so it can be imported
 * by both crm.actions.ts and the /rpc/crm/export Route Handler without
 * triggering Next.js's "all exports must be async" constraint on "use server" files.
 *
 * Rate limit: 3 exports per rolling 60-minute window per owner userId.
 * Keyed by userId (not IP) since the export is an authenticated action.
 * State is persisted in the `rate_limit_hits` DB table under the "export" namespace.
 */

import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";
import { PostgresRateLimitStore } from "@/lib/rate-limit-store";

/**
 * exportRateLimiter — module-level singleton.
 *
 * Backed by PostgresRateLimitStore so the 3/hr limit persists across restarts.
 * Keyed by the owner's DB UUID so the limit is per-user, not per-IP.
 * DB key format: "export:<userId>" (namespaced by PostgresRateLimitStore).
 */
export const exportRateLimiter = new SlidingWindowRateLimiter(
  { max: 3, windowMs: 60 * 60 * 1_000 }, // 60-minute sliding window
  new PostgresRateLimitStore("export"),
);

/**
 * consumeExportSlot — Record an export hit in the rate limiter.
 *
 * Called exclusively by the Route Handler AFTER authentication and BEFORE
 * streaming the response. Returns whether the export is allowed.
 *
 * Now async because the backing store performs a DB UPSERT.
 *
 * @param userId — The owner's DB UUID (used as the rate limit key)
 * @returns Promise<{ allowed, remaining }> — whether the slot was granted + slots left
 */
export async function consumeExportSlot(
  userId: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const result = await exportRateLimiter.check(userId);
  return { allowed: result.allowed, remaining: Math.max(0, result.remaining) };
}
