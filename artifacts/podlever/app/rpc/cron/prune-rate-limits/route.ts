/**
 * app/rpc/cron/prune-rate-limits/route.ts — Periodic cleanup of stale rate-limit rows
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #46 — prevent stale rate_limit_hits accumulation)
 *
 * Route: POST /rpc/cron/prune-rate-limits
 *
 * HUMAN REVIEW NOTES:
 * This route is called by an external cron scheduler (e.g. Replit Scheduled Deployments,
 * GitHub Actions cron, cron-job.org, or similar) once per hour to remove rows from
 * `rate_limit_hits` whose `updated_at` timestamp is older than 2 hours (2× the longest
 * configured window, which is the 60-minute export window).
 *
 * Why 2 hours?
 *   The sliding-window logic prunes stale timestamps from `hit_timestamps` on every
 *   read+write, so a row with an empty array is harmless — but it still occupies a
 *   table page. Rows that haven't been touched for more than 2 hours are guaranteed to
 *   have all their timestamps expire before the next check, making them permanently idle.
 *   Deleting them at 2× window gives a full extra window of margin before eviction.
 *
 * Security:
 *   - The route is authenticated via a constant-time comparison of the Authorization
 *     header against the CRON_SECRET environment variable (Bearer token scheme).
 *   - Without CRON_SECRET the route is disabled and returns 503.
 *   - Requests without the correct Bearer token receive 401.
 *   - No PII is written to logs — only the deleted row count is returned.
 *
 * Setup:
 *   1. Generate a strong secret: openssl rand -hex 32
 *   2. Add it as a Replit Secret named CRON_SECRET.
 *   3. Configure your cron scheduler to POST to:
 *        https://<your-domain>/rpc/cron/prune-rate-limits
 *      with the header:
 *        Authorization: Bearer <CRON_SECRET value>
 *
 * Response:
 *   200 — { deleted: <number> }   — cleanup ran; deleted reports how many rows were removed
 *   401 — Unauthorized            — missing or incorrect Bearer token
 *   503 — Service Unavailable     — CRON_SECRET not configured in environment
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { PostgresRateLimitStore } from "@/lib/rate-limit-store";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * STALE_THRESHOLD_MS — rows not updated within this period are considered permanently idle.
 *
 * Set to 2× the longest rate-limit window currently configured:
 *   Longest window = 60 minutes (export limiter, lib/export-rate-limiter.ts)
 *   Threshold      = 2 × 60 min = 120 minutes = 2 hours
 *
 * If a new limiter with a longer window is added, update this constant accordingly.
 */
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1_000; // 2 hours in milliseconds

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /rpc/cron/prune-rate-limits
 *
 * Deletes rows from `rate_limit_hits` where `updated_at` < NOW() - 2 hours.
 * Returns a JSON body with the count of deleted rows.
 *
 * Authentication: Bearer token in Authorization header, matched against CRON_SECRET.
 * Uses timingSafeEqual to prevent timing-based token enumeration attacks.
 */
export async function POST(req: Request): Promise<NextResponse> {
  // ── 1. Guard: CRON_SECRET must be configured ──────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Configuration error — do not expose details in the response body.
    console.error("[cron/prune-rate-limits] CRON_SECRET environment variable is not set.");
    return NextResponse.json(
      { error: "Cron endpoint is not configured." },
      { status: 503 },
    );
  }

  // ── 2. Authenticate the request ───────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";

  // Extract the token from "Bearer <token>".
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // Constant-time comparison prevents timing attacks that could leak the secret length.
  let authorized = false;
  try {
    const secretBuf = Buffer.from(cronSecret, "utf8");
    const tokenBuf  = Buffer.from(token, "utf8");
    // timingSafeEqual requires equal-length buffers; length mismatch → not authorized.
    if (secretBuf.length === tokenBuf.length) {
      authorized = timingSafeEqual(secretBuf, tokenBuf);
    }
  } catch {
    // timingSafeEqual can throw on unexpected input — treat as unauthorized.
    authorized = false;
  }

  if (!authorized) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  // ── 3. Run the prune ──────────────────────────────────────────────────────
  const cutoffMs = Date.now() - STALE_THRESHOLD_MS;

  try {
    const deleted = await PostgresRateLimitStore.pruneStaleRows(cutoffMs);
    console.info(`[cron/prune-rate-limits] Pruned ${deleted} stale row(s) (cutoff: ${new Date(cutoffMs).toISOString()}).`);
    return NextResponse.json({ deleted }, { status: 200 });
  } catch (err) {
    // Log the error server-side; do not expose DB details to the caller.
    console.error("[cron/prune-rate-limits] Prune query failed:", err);
    return NextResponse.json(
      { error: "Prune failed. See server logs." },
      { status: 500 },
    );
  }
}
