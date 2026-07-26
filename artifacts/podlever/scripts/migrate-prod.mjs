#!/usr/bin/env node
/**
 * scripts/migrate-prod.mjs — Drift-proof production migration runner
 *
 * Part of: PodLever
 * Last modified: 2026-07-26 by agent (deploy unblock — drift-proof rewrite)
 *
 * WHY THIS EXISTS (history):
 *   Production schema changes were sometimes applied manually via the Replit
 *   SQL console (emergency fixes), which put the real database ahead of the
 *   drizzle migration ledger. `drizzle-kit migrate` is all-or-nothing per
 *   migration file: re-applying a migration whose columns already exist dies
 *   with `42701 column already exists` and aborts the whole deploy build.
 *
 * WHAT THIS DOES INSTEAD (no drizzle-kit involved):
 *   1. Connects to DATABASE_URL.
 *   2. Keeps its own ledger: drizzle.__podlever_migrations (tag PRIMARY KEY).
 *   3. For every db/migrations/*.sql not in the ledger, splits the file on
 *      `--> statement-breakpoint` and runs each statement individually.
 *   4. Statements that fail ONLY because the object already exists are
 *      skipped (duplicate column/table/index/constraint/type/schema/function).
 *      Any other error fails the build loudly.
 *   5. Marks the file applied. Re-runs are no-ops.
 *
 *   Net effect: manual console fixes can never break a deploy again, and
 *   new migrations apply automatically on every Republish.
 *
 * Environment: DATABASE_URL (required)
 * Run: node scripts/migrate-prod.mjs   (wired into `pnpm build:prod`)
 */

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Client } = pkg;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

/** SQLSTATE codes meaning "this object already exists" — safe to skip. */
const ALREADY_EXISTS = new Set([
  "42701", // duplicate_column
  "42P07", // duplicate_table (also indexes/relations)
  "42710", // duplicate_object (constraints, types, enum values)
  "42P06", // duplicate_schema
  "42723", // duplicate_function
]);

function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 0000_…, 0001_… — lexicographic == chronological
}

function splitStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrate-prod] ERROR: DATABASE_URL is not set");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // ── Ledger ────────────────────────────────────────────────────────────
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__podlever_migrations (
        tag        TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const done = await client.query(`SELECT tag FROM drizzle.__podlever_migrations;`);
    const applied = new Set(done.rows.map((r) => r.tag));

    const files = listMigrationFiles();
    let ran = 0;

    for (const file of files) {
      const tag = file.replace(/\.sql$/, "");
      if (applied.has(tag)) continue;

      const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      console.log(`[migrate-prod] Applying ${tag} (${statements.length} statement${statements.length === 1 ? "" : "s"})`);

      let executed = 0;
      let skipped = 0;
      for (const stmt of statements) {
        try {
          // Each statement runs as its own implicit transaction; required for
          // e.g. ALTER TYPE … ADD VALUE, which can't run inside a tx block.
          await client.query(stmt);
          executed++;
        } catch (err) {
          if (err && ALREADY_EXISTS.has(err.code)) {
            skipped++;
            console.log(`[migrate-prod]   skip (already exists, ${err.code}): ${stmt.slice(0, 90).replace(/\s+/g, " ")}…`);
          } else {
            console.error(`[migrate-prod] FAILED in ${tag}: ${stmt.slice(0, 200)}`);
            console.error(`[migrate-prod] ${err?.code ?? ""} ${err?.message ?? err}`);
            process.exit(1);
          }
        }
      }

      await client.query(
        `INSERT INTO drizzle.__podlever_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING;`,
        [tag],
      );
      applied.add(tag);
      ran++;
      console.log(`[migrate-prod]   done — ${executed} executed, ${skipped} skipped as pre-existing`);
    }

    if (ran === 0) {
      console.log(`[migrate-prod] Database up to date (${files.length} migrations tracked)`);
    } else {
      console.log(`[migrate-prod] Migrations complete — ${ran} file(s) applied`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate-prod] Unexpected error:", err);
  process.exit(1);
});
