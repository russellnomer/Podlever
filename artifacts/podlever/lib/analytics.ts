/**
 * lib/analytics.ts — Server-side first-party event tracking
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #15 — Analytics)
 *
 * DESIGN PRINCIPLES:
 *   1. Fire-and-forget: trackEvent() never throws, never blocks the caller.
 *      Errors are logged; analytics must never break the product.
 *   2. PII-free: caller responsibility — no emails, display names, or audio URLs
 *      in properties. This is enforced by code review, not by the schema.
 *   3. Server-side only: no client scripts. All events written directly to DB.
 *   4. Single import: callers import { trackEvent } from "@/lib/analytics".
 *
 * SECURITY: No user-supplied strings are interpolated into SQL.
 * Properties are stored as JSONB via parameterized Drizzle bindings.
 *
 * Usage:
 *   void trackEvent("auth.login", { userId: "...", role: "owner" });
 *   void trackEvent("episode_processed", { userId: "...", assetCount: 5 });
 *   void trackEvent("page_view", { path: "/pricing" }); // pre-auth
 */

import { db }               from "@/db";
import { analyticsEvents }  from "@/db/schema/analytics-events";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * TrackPayload — shape passed to trackEvent().
 *
 * userId is optional (pre-auth events have no user yet).
 * sessionId is optional (server-side events may not have a browser session).
 * properties must be PII-free JSON.
 */
export interface TrackPayload {
  userId?:     string | null;
  sessionId?:  string | null;
  properties?: Record<string, unknown>;
}

// ─── Core function ─────────────────────────────────────────────────────────────

/**
 * trackEvent — Append a single analytics event to the DB.
 *
 * NEVER awaited by the caller in most cases — call as `void trackEvent(...)`.
 * The returned Promise resolves after the INSERT; errors are swallowed after logging.
 *
 * @param eventName - One of ANALYTICS_EVENTS values (or any string for ad-hoc events)
 * @param payload   - userId, sessionId, and PII-free properties
 */
export async function trackEvent(
  eventName: string,
  payload: TrackPayload = {},
): Promise<void> {
  const { userId = null, sessionId = null, properties = {} } = payload;
  try {
    await db.insert(analyticsEvents).values({
      userId:     userId ?? undefined,
      sessionId:  sessionId ?? undefined,
      eventName,
      properties,
    });
  } catch (err) {
    // Swallow — analytics failures must never surface to users
    console.error(JSON.stringify({
      event:     "analytics.track.failed",
      eventName,
      error:     err instanceof Error ? err.message : String(err),
      ts:        new Date().toISOString(),
    }));
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * trackServerEvent — wrapper for purely server-side events with no session context.
 * Shorthand for trackEvent(name, { userId, properties }).
 */
export function trackServerEvent(
  eventName: string,
  userId: string | null,
  properties?: Record<string, unknown>,
): void {
  void trackEvent(eventName, { userId, properties });
}
