/**
 * lib/startup-migrations.ts — Runtime (server-startup) database migrations
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent
 *
 * WHY RUNTIME AND NOT BUILD TIME:
 *   Replit Autoscale builds run in the workspace environment, where
 *   DATABASE_URL points at the DEVELOPMENT database. The PRODUCTION
 *   database URL is only injected into the deployment at RUNTIME.
 *   Running migrations during `build:prod` therefore syncs dev and never
 *   touches prod (this is how prod drifted behind and broke both the
 *   login flow and the episodes insert). Running them from
 *   instrumentation.ts `register()` executes against the real production
 *   database on every server boot.
 *
 * BEHAVIOUR (same drift-proof semantics as scripts/migrate-prod.mjs):
 *   - Own ledger: drizzle.__podlever_migrations (tag PRIMARY KEY)
 *   - Applies each untracked db/migrations/*.sql statement-by-statement
 *     (split on `--> statement-breakpoint`)
 *   - Skips statements failing ONLY with already-exists SQLSTATEs
 *   - Serialises concurrent Autoscale instances via pg advisory lock
 *   - Logs loudly on real errors but DOES NOT crash the server (a boot
 *     crash on Autoscale would be a full outage; the app can still serve
 *     requests on the pre-migration schema)
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { verifyAndHealSchema, markBooted } from "./schema-guard";

/** SQLSTATE codes meaning "this object already exists" — safe to skip. */
const ALREADY_EXISTS = new Set([
  "42701", // duplicate_column
  "42P07", // duplicate_table (also indexes/relations)
  "42710", // duplicate_object (constraints, types, enum values)
  "42P06", // duplicate_schema
  "42723", // duplicate_function
]);

/** Stable lock key for pg_advisory_lock (any int32 pair works). */
const LOCK_CLASS = 0x0d1e;
const LOCK_ID = 0x9057;

function migrationsDir(): string {
  // process.cwd() is artifacts/podlever both in dev and in the deployment.
  return join(process.cwd(), "db", "migrations");
}

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Run all pending migrations against DATABASE_URL.
 * Never throws — logs and returns so server boot always completes.
 */
export async function runStartupMigrations(): Promise<void> {
  markBooted();
  console.log(
    `[startup-migrations] ═══════ PodLever boot ${new Date().toISOString()} — checking database schema ═══════`,
  );
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[startup-migrations] DATABASE_URL not set — skipping");
    return;
  }

  const dir = migrationsDir();
  if (!existsSync(dir)) {
    console.error(`[startup-migrations] migrations dir missing (${dir}) — skipping`);
    return;
  }

  // Dynamic import keeps this module side-effect-free at import time
  // (instrumentation.ts requirement).
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    // Log WHICH database we are connected to (host + db name, never
    // credentials). During the 2026-07-26 incident, manual fixes went into a
    // console that was NOT the database the app actually uses — this line
    // makes that mismatch visible instantly.
    try {
      const host = new URL(databaseUrl).host;
      const ident = await client.query(
        `SELECT current_database() AS db, current_user AS usr;`,
      );
      console.log(
        `[startup-migrations] connected to host=${host} db=${ident.rows[0]?.db} user=${ident.rows[0]?.usr}`,
      );
    } catch {
      /* fingerprint is best-effort */
    }

    // Serialise concurrent instances (Autoscale can boot several at once).
    await client.query("SELECT pg_advisory_lock($1, $2);", [LOCK_CLASS, LOCK_ID]);

    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle;`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS drizzle.__podlever_migrations (
          tag        TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      const done = await client.query(`SELECT tag FROM drizzle.__podlever_migrations;`);
      const applied = new Set<string>(done.rows.map((r: { tag: string }) => r.tag));

      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort(); // 0000_…, 0001_… — lexicographic == chronological

      let ran = 0;
      for (const file of files) {
        const tag = file.replace(/\.sql$/, "");
        if (applied.has(tag)) continue;

        const statements = splitStatements(readFileSync(join(dir, file), "utf8"));
        console.log(`[startup-migrations] Applying ${tag} (${statements.length} statements)`);

        let executed = 0;
        let skipped = 0;
        for (const stmt of statements) {
          try {
            // Each statement is its own implicit transaction (required for
            // e.g. ALTER TYPE … ADD VALUE).
            await client.query(stmt);
            executed++;
          } catch (err) {
            const code = (err as { code?: string })?.code;
            if (code && ALREADY_EXISTS.has(code)) {
              skipped++;
            } else {
              console.error(
                `[startup-migrations] ❌ FAILED in ${tag}: ${stmt.slice(0, 200)}\n` +
                  `[startup-migrations] ${code ?? ""} ${(err as Error)?.message ?? err}`,
              );
              return; // stop; do not mark applied; do not crash the server
            }
          }
        }

        await client.query(
          `INSERT INTO drizzle.__podlever_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING;`,
          [tag],
        );
        applied.add(tag);
        ran++;
        console.log(
          `[startup-migrations]   ${tag} done — ${executed} executed, ${skipped} skipped as pre-existing`,
        );
      }

      console.log(
        ran === 0
          ? `[startup-migrations] Database up to date (${files.length} migrations tracked)`
          : `[startup-migrations] ✅ Complete — ${ran} migration file(s) applied`,
      );

      // A ledger records what WAS applied, not what IS true — something can
      // drop columns after the fact (e.g. a stray `drizzle-kit push`).
      // Verify the live schema against db/schema and re-add anything missing.
      await verifyAndHealSchema(client, { heal: true });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2);", [LOCK_CLASS, LOCK_ID]);
    }
  } catch (err) {
    console.error("[startup-migrations] Unexpected error:", err);
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}
