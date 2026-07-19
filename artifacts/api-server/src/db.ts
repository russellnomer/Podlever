/**
 * db.ts — Re-export the shared Drizzle database connection
 *
 * Part of: PodLever API Server
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Uses the @workspace/db package which manages the connection pool.
 * Both the API server and lib/db reference the same DATABASE_URL.
 */

export { db } from "@workspace/db";
