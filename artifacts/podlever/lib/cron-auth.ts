/**
 * lib/cron-auth.ts — Shared constant-time CRON_SECRET authorization
 *
 * Part of: PodLever
 * Created: 2026-07-27 by agent (Security sprint — PR #22)
 *
 * One implementation for every internal route gated by CRON_SECRET
 * (/rpc/queue/worker, /rpc/episodes/[id]/process, /rpc/health/schema,
 * /rpc/cron/*). Rules:
 *   - Authorization: Bearer header ONLY. Never a query parameter — query
 *     strings appear in autoscale/Cloud Run access logs and would leak the
 *     secret to anyone with log access.
 *   - timingSafeEqual, never `===` — constant-time comparison.
 */

import { timingSafeEqual } from "node:crypto";

/** True when the request carries `Authorization: Bearer <CRON_SECRET>`. */
export function isCronAuthorized(authorizationHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = (authorizationHeader ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  try {
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
