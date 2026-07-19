/**
 * index.ts — PodLever API server entry point
 *
 * Part of: PodLever API Server
 * Created: 2026-07-18
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Startup sequence:
 *   1. runStripeDbMigrations() — create stripe schema + tables using the
 *      stripe-replit-sync package's own SQL files (bypasses bundling issue
 *      where esbuild rewrites __dirname to the API server dist dir)
 *   2. getStripeSync() → findOrCreateManagedWebhook()
 *   3. syncBackfill() — fire-and-forget
 *   4. Start HTTP server
 *
 * WHY NOT runMigrations() from stripe-replit-sync?
 *   stripe-replit-sync uses path.resolve(__dirname, "./migrations") internally.
 *   When esbuild bundles the API server, __dirname becomes the API server's
 *   dist/ dir, not the stripe-replit-sync package dir. The migration files
 *   are never found. We resolve the path ourselves using createRequire.
 */

import { createRequire }     from "node:module";
import path                  from "node:path";
import fs                    from "node:fs";
import { pool }              from "@workspace/db";
import { getStripeSync }     from "./stripeClient";
import app                   from "./app";
import { logger }            from "./lib/logger";

// ─── Stripe database bootstrap ────────────────────────────────────────────────

/**
 * runStripeDbMigrations — Create stripe schema + all stripe-replit-sync tables.
 *
 * Resolves the migration SQL files directly from the installed package path,
 * bypassing the esbuild __dirname rewrite issue.
 * Idempotent — safe to call on every startup.
 */
async function runStripeDbMigrations(): Promise<void> {
  // Resolve migrations directory from the installed package (not the bundle)
  const require        = createRequire(import.meta.url);
  const pkgMain        = require.resolve("stripe-replit-sync");
  const pkgDist        = path.dirname(pkgMain);
  const migrationsDir  = path.join(pkgDist, "migrations");

  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ migrationsDir }, "stripe-replit-sync migrations dir not found — skipping");
    return;
  }

  // Use the shared pool from @workspace/db — acquires a dedicated client for migrations
  const client = await pool.connect();

  try {
    // 1. Create stripe schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS stripe`);

    // 2. Create migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS stripe._migrations (
        id   SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        run_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 3. Run migration SQL files in order, skipping already-applied ones
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows: applied } = await client.query(
      `SELECT name FROM stripe._migrations`,
    );
    const appliedNames = new Set(applied.map((r: { name: string }) => r.name));

    for (const file of files) {
      if (appliedNames.has(file)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await client.query(sql);
      await client.query(
        `INSERT INTO stripe._migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [file],
      );
      logger.info({ file }, "Applied stripe migration");
    }

    logger.info("Stripe DB migrations complete");
  } finally {
    client.release();
  }
}

// ─── Stripe initialization ────────────────────────────────────────────────────

async function initStripe(): Promise<void> {
  logger.info("Initializing Stripe schema...");
  await runStripeDbMigrations();
  logger.info("Stripe schema ready");

  const stripeSync    = await getStripeSync();
  const domain        = process.env.REPLIT_DOMAINS?.split(",")[0];
  const webhookResult = await stripeSync.findOrCreateManagedWebhook(
    `https://${domain}/api/stripe/webhook`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webhookUrl = (webhookResult as any)?.webhook?.url ?? "configured";
  logger.info({ url: webhookUrl }, "Webhook set up");

  // Non-blocking backfill — resolve on success, log on error
  stripeSync.syncBackfill()
    .then(() => logger.info("Stripe backfill complete"))
    .catch((err) => logger.error({ err }, "Stripe backfill error"));
}

// ─── Server startup ───────────────────────────────────────────────────────────

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT: "${rawPort}"`);

await initStripe().catch((err) => {
  logger.error({ err }, "Stripe initialization failed — server starting without Stripe");
});

app.listen(port, (err) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }
  logger.info({ port }, "Server listening");
});
