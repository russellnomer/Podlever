/**
 * lib/db/src/schema/users.ts — API server's view of the public.users table
 *
 * Part of: PodLever shared DB package
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * This is the API server's Drizzle type definition for the users table.
 * It mirrors only the columns the API server needs to read/write.
 * The AUTHORITATIVE schema + migrations live in artifacts/podlever/db/schema/users.ts.
 * Do NOT run migrations from this package — use podlever's db:migrate instead.
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * users — API server's projection of the public.users table.
 * Only columns needed for Stripe lifecycle webhook handling are included.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Stripe customer ID — set on first checkout. */
  stripeCustomerId: text("stripe_customer_id").unique(),

  /** Active Stripe subscription ID. Null when on free plan. */
  stripeSubscriptionId: text("stripe_subscription_id"),

  /** Current plan slug matching lib/tiers.ts keys. */
  plan: text("plan").notNull().default("free"),

  /** UTC end of the current paid billing period. Null for free plan. */
  planPeriodEnd: timestamp("plan_period_end", { withTimezone: true }),

  /** Grace period end after a failed payment. Null when no grace period active. */
  paymentGraceUntil: timestamp("payment_grace_until", { withTimezone: true }),
});

export type User    = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
