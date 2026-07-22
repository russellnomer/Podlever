#!/usr/bin/env node
/**
 * scripts/migrate-prod.mjs — Production migration bootstrap runner
 *
 * Purpose:
 *   Run Drizzle migrations safely against the target database.
 *   Handles the bootstrap case where the drizzle.__drizzle_migrations tracking
 *   table doesn't exist yet but the schema was previously applied via db:push
 *   or another mechanism (common in early Replit deployments).
 *
 * What it does:
 *   1. Connects to DATABASE_URL
 *   2. Creates the drizzle schema + __drizzle_migrations table if missing
 *   3. Pre-seeds known-applied migration hashes (avoids re-running already-
 *      applied migrations whose tables already exist in the DB)
 *   4. Runs `drizzle-kit migrate` — which only applies un-tracked migrations
 *
 * Run:
 *   node scripts/migrate-prod.mjs
 *   (or via npm script: pnpm run db:migrate:prod)
 *
 * Environment:
 *   DATABASE_URL — required; read from environment or Replit Secrets
 *
 * Safety notes:
 *   - Pre-seeded hashes match those in the dev drizzle.__drizzle_migrations
 *     table for migrations 0000–0007, which were applied before tracking existed.
 *   - Only runs INSERT for hashes not already present (idempotent).
 *   - Uses ON CONFLICT DO NOTHING to prevent duplicate-hash errors on re-runs.
 */

import { execSync } from "child_process";
import pkg from "pg";

const { Client } = pkg;

// ─── Migration hashes for migrations already applied to production ────────────
// These correspond to: 0000, 0001, 0003, 0004, 0005, 0006, 0007
// (0002 was applied via db:push and is intentionally absent from tracking)
// (0008+ will be applied by drizzle-kit migrate below)
const KNOWN_APPLIED = [
  { hash: "a5cffff53c5a485d7713857acf76c67ae3c89cb3c97bed0df59db1ccb9db838d", created_at: 1784435720964 },
  { hash: "06a6d0461fde07cffa951876379bca923e35aca4a79c56fff9027c0aed824d5f", created_at: 1784469539550 },
  { hash: "f69cf84ea6fb6b5be37389355283f34267274fd4eb643652f7bccd5f73cfb12d", created_at: 1784486321207 },
  { hash: "78ef11e6a0bcfc83f9348770f57ecf79a7b53d6eeab2f0dded9eb81ab900a200", created_at: 1784486843280 },
  { hash: "138b742dd409358608d259650d343a3b4043d6131cfdf383fb64777a43b9a0d9", created_at: 1784487386632 },
  { hash: "0b372bd3ceb414d4ed08d8d42af49ae99c22702bf249e8e87949fc51625eddf5", created_at: 1784487775222 },
  { hash: "2617dd9d16875b2e9fbe7b50b35bc3715c3930dbe0943489a4485079024a9a68", created_at: 1784488355818 },
];

async function bootstrap() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrate-prod] ERROR: DATABASE_URL is not set");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // ── 1. Ensure drizzle schema and tracking table exist ───────────────────
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id        SERIAL PRIMARY KEY,
        hash      TEXT NOT NULL,
        created_at BIGINT
      );
    `);
    console.log("[migrate-prod] Drizzle tracking table ready");

    // ── 2. Seed hashes for previously-applied migrations (idempotent) ───────
    // Use a temp table to do a single bulk upsert check efficiently.
    const existing = await client.query(
      `SELECT hash FROM drizzle.__drizzle_migrations;`
    );
    const existingHashes = new Set(existing.rows.map((r) => r.hash));

    let seeded = 0;
    for (const { hash, created_at } of KNOWN_APPLIED) {
      if (!existingHashes.has(hash)) {
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
          [hash, created_at]
        );
        seeded++;
      }
    }
    if (seeded > 0) {
      console.log(`[migrate-prod] Seeded ${seeded} previously-applied migration hashes`);
    } else {
      console.log("[migrate-prod] Tracking table already up to date — no seeding needed");
    }
  } finally {
    await client.end();
  }

  // ── 3. Run drizzle-kit migrate (applies only untracked migrations) ─────────
  console.log("[migrate-prod] Running drizzle-kit migrate...");
  try {
    execSync(
      "pnpm drizzle-kit migrate --config drizzle.config.ts",
      { stdio: "inherit", cwd: process.cwd() }
    );
    console.log("[migrate-prod] Migrations complete");
  } catch (err) {
    console.error("[migrate-prod] drizzle-kit migrate failed:", err.message);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  console.error("[migrate-prod] Unexpected error:", err);
  process.exit(1);
});
