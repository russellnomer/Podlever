/**
 * db/schema/analytics-events.ts — First-party analytics event log
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #15 — Analytics)
 *
 * Append-only table. One row per tracked event (page view, auth, product action).
 * No third-party scripts — all analytics are in-house and PII-free.
 *
 * HUMAN REVIEW NOTES:
 * - `user_id` is nullable to support pre-auth events (page_view, waitlist_signup).
 * - `session_id` is a client-generated UUID stored in a cookie; used to stitch
 *   pre-auth events to post-auth events for funnel analysis.
 * - `properties` is JSONB — queryable via Postgres JSON operators.
 * - Never store PII in `properties` (no emails, display names, audio URLs).
 */

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// ─── Event name constants ─────────────────────────────────────────────────────

/**
 * ANALYTICS_EVENTS — canonical event names.
 * Stored as text in the DB — extend this list without migrations.
 */
export const ANALYTICS_EVENTS = {
  PAGE_VIEW:             "page_view",
  SIGNUP:                "signup",
  AUTH_LOGIN:            "auth.login",
  EPISODE_CREATED:       "episode_created",
  EPISODE_PROCESSED:     "episode_processed",
  UPGRADE_PROMPT_SHOWN:  "upgrade_prompt_shown",
  SUBSCRIPTION_STARTED:  "subscription_started",
  SUBSCRIPTION_CANCELLED:"subscription_cancelled",
  INVITE_CLAIMED:        "invite_claimed",
  ONBOARDING_COMPLETED:  "onboarding_completed",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

// ─── Table ─────────────────────────────────────────────────────────────────────

export const analyticsEvents = pgTable("analytics_events", {
  /** Surrogate primary key. */
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * Authenticated user who triggered the event. Nullable for pre-auth events.
   * SET NULL on user deletion (retain aggregate analytics; drop the identity link).
   */
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

  /**
   * Anonymous session identifier — generated client-side, stored in a cookie.
   * Used to link pre-auth events (page_view) to post-auth events (signup, login).
   * Nullable for server-side events without a browser session.
   */
  sessionId: text("session_id"),

  /**
   * Event name — one of ANALYTICS_EVENTS values.
   * Stored as text for flexibility; application validates against the constant.
   */
  eventName: text("event_name").notNull(),

  /**
   * Structured event context as JSONB. Examples:
   *   page_view:         { path: "/pricing" }
   *   episode_processed: { assetCount: 5, processingMs: 45000 }
   *   upgrade_prompt_shown: { currentPlan: "free", used: 1, limit: 1 }
   *
   * NEVER store PII — no emails, display names, or user-identifying content.
   */
  properties: jsonb("properties").$type<Record<string, unknown>>().default({}),

  /** UTC timestamp of the event. Indexed for time-range queries. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnalyticsEvent    = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
