/**
 * db/schema/waitlist.ts — Drizzle schema for the `waitlist` table
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — Landing page + waitlist capture)
 *
 * Stores emails submitted via the landing page "Early Access" capture form.
 * Phase 1: Store only — no automated email sending.
 * Phase 2 (Stripe task): Mark entries as converted when they subscribe.
 *
 * HUMAN REVIEW NOTES:
 * - No PII beyond email — do not add name, phone, or IP fields.
 * - Unique constraint on email prevents duplicates (upsert pattern in action).
 * - `source` tracks which page/CTA triggered the signup (landing, pricing, etc.)
 *   for basic funnel analytics without a full analytics platform.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Table ───────────────────────────────────────────────────────────────────

/**
 * waitlist — Early access email captures.
 *
 * Emails are stored in lowercase (enforced in the server action).
 * The unique constraint on `email` enables safe upserts: re-submitting
 * the same email updates the `source` and `created_at` timestamp rather
 * than creating a duplicate row.
 */
export const waitlist = pgTable("waitlist", {
  /** Surrogate primary key. */
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * Subscriber email address, lowercased at insert time.
   * Unique so duplicate submissions are deduplicated at the DB level.
   */
  email: text("email").notNull().unique(),

  /**
   * CTA source page/variant — used for funnel analysis.
   * E.g., "landing_hero", "landing_pricing", "pricing_page", "footer"
   */
  source: text("source").notNull().default("landing"),

  /** ISO timestamp of first submission. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;
