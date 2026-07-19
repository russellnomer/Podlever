/**
 * schema.ts — API server's local schema definition for public.users
 *
 * Part of: PodLever API Server
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Defines only the columns the API server needs to read/write.
 * The AUTHORITATIVE schema + migrations live in artifacts/podlever/db/schema/users.ts.
 * This is a Drizzle type projection only — no migrations run from here.
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  stripeCustomerId:     text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan:                 text("plan").notNull().default("free"),
  planPeriodEnd:        timestamp("plan_period_end",     { withTimezone: true }),
  paymentGraceUntil:    timestamp("payment_grace_until", { withTimezone: true }),
});
