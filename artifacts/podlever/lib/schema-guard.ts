/**
 * lib/schema-guard.ts — Live schema verification + self-healing
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent
 *
 * WHY THIS EXISTS:
 *   On 2026-07-26 the production database lost the episodes.processing_stage
 *   and episodes.processing_error columns AFTER they had been created
 *   (most likely a `drizzle-kit push` run against production from a stale
 *   schema checkout — push DIFFS the code schema against the live DB and
 *   DROPS anything it does not recognize). The migration ledger said
 *   "0010 applied", so the ledger-trusting startup migrator did not
 *   re-apply it, and every page touching those columns crashed.
 *
 *   Lesson: a migration ledger records what WAS applied, not what IS true.
 *   This module verifies the ACTUAL database shape against the code's own
 *   Drizzle schema on every boot (and on demand via /rpc/health/schema),
 *   and re-adds any missing column non-destructively.
 *
 * GUARANTEES:
 *   - Never destructive: only ALTER TABLE … ADD COLUMN IF NOT EXISTS.
 *     Never drops or modifies anything.
 *   - Missing TABLES are reported loudly but not auto-created (a missing
 *     table means something catastrophic happened; recreating it empty
 *     could mask data loss — a human should look).
 *   - Never throws: callers always get a report object.
 */

import type { Client } from "pg";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnDrift {
  table: string;
  column: string;
  sqlType: string;
}

export interface SchemaReport {
  checkedAt: string;
  tablesChecked: number;
  columnsChecked: number;
  missingTables: string[];
  missingColumns: ColumnDrift[];
  healedColumns: ColumnDrift[];
  healErrors: string[];
  ok: boolean;
}

// Survives module duplication across Next.js bundles.
const globalStore = globalThis as unknown as {
  __podleverLastSchemaReport?: SchemaReport;
  __podleverBootedAt?: string;
};

export function getLastSchemaReport(): SchemaReport | undefined {
  return globalStore.__podleverLastSchemaReport;
}

export function markBooted(): void {
  globalStore.__podleverBootedAt ??= new Date().toISOString();
}

export function getBootedAt(): string | undefined {
  return globalStore.__podleverBootedAt;
}

// ─── Expected schema from the code itself ─────────────────────────────────────

interface ExpectedColumn {
  name: string;
  sqlType: string;
}

interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
}

/**
 * Derive the expected shape from db/schema — the same definitions the query
 * builder uses. If a column exists here, a query WILL reference it, so the
 * database MUST have it.
 */
async function getExpectedTables(): Promise<ExpectedTable[]> {
  const [{ getTableConfig }, schema] = await Promise.all([
    import("drizzle-orm/pg-core"),
    import("../db/schema"),
  ]);

  const tables: ExpectedTable[] = [];
  for (const exported of Object.values(schema)) {
    // pgTable objects carry Drizzle's internal symbols; getTableConfig throws
    // on anything else, so probe defensively.
    try {
      const config = getTableConfig(exported as Parameters<typeof getTableConfig>[0]);
      if (!config?.name || !Array.isArray(config.columns)) continue;
      tables.push({
        name: config.name,
        columns: config.columns.map((c) => ({
          name: c.name,
          sqlType: c.getSQLType(),
        })),
      });
    } catch {
      // Not a table export (relations, enums, types) — skip.
    }
  }
  return tables;
}

// ─── Verify + heal ─────────────────────────────────────────────────────────────

/**
 * Compare the live database against the code schema; optionally re-add
 * missing columns. Stores the report for /rpc/health/schema.
 */
export async function verifyAndHealSchema(
  client: Client,
  { heal = true }: { heal?: boolean } = {},
): Promise<SchemaReport> {
  const report: SchemaReport = {
    checkedAt: new Date().toISOString(),
    tablesChecked: 0,
    columnsChecked: 0,
    missingTables: [],
    missingColumns: [],
    healedColumns: [],
    healErrors: [],
    ok: false,
  };

  try {
    const expected = await getExpectedTables();

    const live = await client.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public';`,
    );
    const liveCols = new Map<string, Set<string>>();
    for (const row of live.rows as { table_name: string; column_name: string }[]) {
      if (!liveCols.has(row.table_name)) liveCols.set(row.table_name, new Set());
      liveCols.get(row.table_name)!.add(row.column_name);
    }

    for (const table of expected) {
      report.tablesChecked++;
      const cols = liveCols.get(table.name);
      if (!cols) {
        report.missingTables.push(table.name);
        continue;
      }
      for (const col of table.columns) {
        report.columnsChecked++;
        if (!cols.has(col.name)) {
          report.missingColumns.push({ table: table.name, column: col.name, sqlType: col.sqlType });
        }
      }
    }

    if (report.missingTables.length > 0) {
      console.error(
        `[schema-guard] 🚨 CRITICAL: tables missing in database: ${report.missingTables.join(", ")} — ` +
          `NOT auto-created (possible data loss; investigate immediately).`,
      );
    }

    if (heal && report.missingColumns.length > 0) {
      for (const drift of report.missingColumns) {
        const ddl = `ALTER TABLE "${drift.table}" ADD COLUMN IF NOT EXISTS "${drift.column}" ${drift.sqlType};`;
        try {
          await client.query(ddl);
          report.healedColumns.push(drift);
          console.warn(
            `[schema-guard] 🚑 DRIFT HEALED: re-added ${drift.table}.${drift.column} (${drift.sqlType}). ` +
              `Something dropped this column — check for stray 'drizzle-kit push' runs.`,
          );
        } catch (err) {
          const msg = `${drift.table}.${drift.column}: ${(err as Error)?.message ?? err}`;
          report.healErrors.push(msg);
          console.error(`[schema-guard] ❌ heal failed for ${msg}`);
        }
      }
    }

    report.ok =
      report.missingTables.length === 0 &&
      report.healErrors.length === 0 &&
      (heal ? true : report.missingColumns.length === 0);

    if (report.ok && report.missingColumns.length === 0) {
      console.log(
        `[schema-guard] ✅ schema verified — ${report.tablesChecked} tables / ${report.columnsChecked} columns match db/schema`,
      );
    }
  } catch (err) {
    report.healErrors.push(`verify failed: ${(err as Error)?.message ?? err}`);
    console.error("[schema-guard] Unexpected error during verification:", err);
  }

  globalStore.__podleverLastSchemaReport = report;
  return report;
}
