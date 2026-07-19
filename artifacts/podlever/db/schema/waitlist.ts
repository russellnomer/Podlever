/**
 * db/schema/waitlist.ts — Drizzle schema for the `waitlist` table
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #35 — Lead CRM: add status, notes, updatedAt)
 *
 * Stores emails submitted via the landing page "Early Access" capture form.
 * Phase 1: Store only — no automated email sending.
 * Phase 2 (Stripe task): Mark entries as converted when they subscribe.
 *
 * CRM extension (Task #35):
 *   - `status`    — owner-managed lifecycle state for each lead
 *   - `notes`     — owner-facing freetext notes on the lead
 *   - `updatedAt` — last time the owner modified the record (status or notes)
 *
 * HUMAN REVIEW NOTES:
 * - No PII beyond email — do not add name, phone, or IP fields.
 * - Unique constraint on email prevents duplicates (upsert pattern in action).
 * - `source` tracks which page/CTA triggered the signup (landing, pricing, etc.)
 *   for basic funnel analytics without a full analytics platform.
 * - `status` uses a text column with application-level validation (not a PG enum)
 *   so that adding new statuses does not require a column-type migration.
 *   Valid values: new | contacted | qualified | converted | disqualified
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * LEAD_STATUSES — ordered lifecycle stages for a waitlist lead.
 *
 * Application code validates against this list; the DB stores raw text.
 * New statuses can be added here without a schema migration.
 */
export const LEAD_STATUSES = [
  "new",           // Just signed up — not yet contacted
  "contacted",     // Owner has reached out
  "qualified",     // Confirmed fit for PodLever
  "converted",     // Subscribed (Stripe, Phase 2)
  "disqualified",  // Not a fit; won't pursue
] as const;

/** TypeScript union type for lead status values */
export type LeadStatus = (typeof LEAD_STATUSES)[number];

// ─── Table ───────────────────────────────────────────────────────────────────

/**
 * waitlist — Early access email captures with CRM lifecycle fields.
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

  /**
   * CRM lifecycle status — owner-managed.
   * Valid values defined in LEAD_STATUSES constant above.
   * Stored as text; validated at the application layer before writes.
   * Default: "new" (all fresh signups start here).
   */
  status: text("status").notNull().default("new"),

  /**
   * Owner-facing freetext notes on the lead.
   * Max 1000 characters — enforced in the server action.
   * Nullable: no notes on a lead is the common initial state.
   */
  notes: text("notes"),

  /** ISO timestamp of first submission. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /**
   * ISO timestamp of the last owner update to status or notes.
   * Set server-side on every updateLead() call; null on initial signup
   * (before any CRM activity on the record).
   */
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;
