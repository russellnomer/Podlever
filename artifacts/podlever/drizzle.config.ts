/**
 * drizzle.config.ts — Drizzle Kit configuration for PodLever schema management
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: drizzle-kit, dotenv (for loading .env.local during CLI runs)
 *
 * HUMAN REVIEW NOTES:
 * This file is used exclusively by the drizzle-kit CLI, not at runtime.
 *
 * Migration policy (Phase 1A):
 *   - Use `db:generate` to create migration SQL files in ./db/migrations/
 *   - Use `db:migrate` to apply migrations against the live database
 *   - NEVER use `db:push` in production — it may destructively drop columns
 *   - `db:push` is acceptable ONLY for local dev iteration before the first migration
 *
 * To apply to production: copy the migration SQL and run manually, or set up
 * a post-deploy migration runner in Phase 1B.
 */

import { defineConfig } from "drizzle-kit";

// Read DATABASE_URL directly for drizzle-kit CLI usage.
// (The /config module is not used here because drizzle-kit runs outside Next.js.)
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for drizzle-kit. Set it in .env.local or your environment.",
  );
}

export default defineConfig({
  /** Entry point: the schema barrel export. Drizzle Kit discovers all tables from here. */
  schema: "./db/schema/index.ts",

  /** Output directory for generated SQL migration files. Commit these to version control. */
  out: "./db/migrations",

  /** Database dialect. */
  dialect: "postgresql",

  /** Connection for drizzle-kit push/migrate/studio commands. */
  dbCredentials: {
    url: databaseUrl,
  },

  /** Print verbose output during generate/migrate for easier debugging. */
  verbose: true,

  /** Fail on missing tables rather than silently skipping. */
  strict: true,
});
