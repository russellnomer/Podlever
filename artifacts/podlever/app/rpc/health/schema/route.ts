/**
 * app/rpc/health/schema/route.ts — Live database schema health check
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (schema drift incident)
 *
 * Route: GET /rpc/health/schema?token=<CRON_SECRET>[&heal=1]
 *
 * Answers, from a browser, in one second:
 *   - What code is running (boot time of this server instance)
 *   - Which migrations the ledger has recorded
 *   - Whether the LIVE database matches db/schema right now
 *   - What the boot-time schema guard found and healed
 *
 * `?heal=1` re-runs the non-destructive healer on demand (ADD COLUMN
 * IF NOT EXISTS only — never drops or modifies anything).
 *
 * Auth: CRON_SECRET via `?token=` query param (browser-friendly) or
 * Authorization bearer header. 404s without it so the route stays invisible.
 *
 * SECURITY: exposes table/column NAMES only — never data.
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifyAndHealSchema, getLastSchemaReport, getBootedAt } from "@/lib/schema-guard";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const token = req.nextUrl.searchParams.get("token") ?? "";
  return bearer === secret || token === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const heal = req.nextUrl.searchParams.get("heal") === "1";

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    // Capture the boot-time report BEFORE the live check overwrites it.
    const bootReport = getLastSchemaReport() ?? null;

    const [report, ledger] = await Promise.all([
      verifyAndHealSchema(client, { heal }),
      client
        .query(`SELECT tag, applied_at FROM drizzle.__podlever_migrations ORDER BY tag;`)
        .then((r) => r.rows)
        .catch(() => "ledger table missing"),
    ]);

    // Which database is this app ACTUALLY connected to? (host + name only —
    // never credentials.) Compare against what the Replit console shows.
    let database: Record<string, string | null> = {};
    try {
      const host = new URL(process.env.DATABASE_URL ?? "").host || null;
      const ident = await client.query(`SELECT current_database() AS db, current_user AS usr;`);
      database = { host, name: ident.rows[0]?.db ?? null, user: ident.rows[0]?.usr ?? null };
    } catch {
      database = { host: null, name: null, user: null };
    }

    return NextResponse.json({
      status:
        report.missingColumns.length === 0 && report.ok
          ? "healthy"
          : report.healedColumns.length === report.missingColumns.length &&
              report.missingTables.length === 0 &&
              report.healErrors.length === 0
            ? "drift_healed"
            : "drift_detected",
      serverBootedAt: getBootedAt() ?? null,
      database,
      liveCheck: report,
      bootCheck: bootReport,
      migrationLedger: ledger,
      hint:
        report.missingColumns.length > 0 && !heal
          ? "Missing columns found — call again with &heal=1 to re-add them non-destructively."
          : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: (err as Error)?.message ?? String(err) },
      { status: 500 },
    );
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}
