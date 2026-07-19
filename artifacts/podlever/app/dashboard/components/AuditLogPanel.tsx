/**
 * app/dashboard/components/AuditLogPanel.tsx — Collapsible CRM audit log viewer
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM)
 *
 * Client Component (for collapse toggle). Receives audit entries as props
 * from the server-side parent component — no client-side data fetching.
 *
 * Security:
 *   - Emails are NEVER displayed in this panel (they are not in audit meta)
 *   - All data comes from server props — no client API calls
 *   - Display-only; no mutations originate from this component
 *
 * HUMAN REVIEW NOTES:
 * - The audit log is append-only and tamper-evident at the DB level.
 * - The UI displays last 100 entries only (sufficient for operational review).
 * - The meta JSONB field is rendered as a read-only JSON tree — no parsing of
 *   user-supplied content occurs here (it was parsed and structured server-side).
 */

"use client";

import { type ReactNode, useState } from "react";
import type { CrmAuditEntry } from "@/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditLogPanelProps {
  entries: CrmAuditEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  lead_viewed:   "text-zinc-400 bg-zinc-800/60",
  lead_updated:  "text-blue-300 bg-blue-500/10",
  lead_exported: "text-amber-300 bg-amber-500/10",
  auth_denied:   "text-red-400 bg-red-500/10",
};

const ACTION_LABELS: Record<string, string> = {
  lead_viewed:   "Viewed",
  lead_updated:  "Updated",
  lead_exported: "Exported",
  auth_denied:   "Auth Denied",
};

function formatTimestamp(date: Date): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "UTC",
  }) + " UTC";
}

/**
 * MetaSummary — compact one-line summary of an audit entry's meta field.
 * Shows key context without exposing raw JSON to the operator.
 */
function MetaSummary({ action, meta }: { action: string; meta: unknown }): ReactNode {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;

  if (action === "lead_viewed") {
    const parts: string[] = [];
    if (m.resultCount !== undefined) parts.push(`${m.resultCount} rows`);
    if (m.status) parts.push(`status:${String(m.status)}`);
    if (m.source) parts.push(`source:${String(m.source)}`);
    if (m.searchActive) parts.push("search:active");
    return <span>{parts.join(" · ")}</span>;
  }

  if (action === "lead_updated") {
    const parts: string[] = [];
    if (m.statusBefore !== undefined && m.statusAfter !== undefined) {
      parts.push(`${String(m.statusBefore)} → ${String(m.statusAfter)}`);
    }
    if (m.notesAfter !== undefined) {
      parts.push(`notes: ${String(m.notesAfter)}`);
    }
    return <span>{parts.join(" · ")}</span>;
  }

  if (action === "lead_exported") {
    return <span>{String(m.rowCount)} rows · {String(m.format)}</span>;
  }

  if (action === "auth_denied") {
    return <span>{String(m.reason ?? "unknown")} · {String(m.context ?? "")}</span>;
  }

  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuditLogPanel({ entries }: AuditLogPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-3">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-1 text-left"
        aria-expanded={expanded}
        aria-controls="audit-log-panel"
      >
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Audit Log
          <span className="ml-2 text-zinc-700 font-normal normal-case">
            (last {entries.length})
          </span>
        </h2>
        <svg
          className={`w-4 h-4 text-zinc-600 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Audit entries */}
      {expanded && (
        <div
          id="audit-log-panel"
          className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden"
        >
          {entries.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-zinc-600 text-sm">No audit entries yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {entries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  {/* Action badge */}
                  <span
                    className={`
                      shrink-0 text-xs px-2 py-0.5 rounded-md font-medium
                      ${ACTION_COLORS[entry.action] ?? "text-zinc-400 bg-zinc-800/60"}
                    `}
                  >
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>

                  {/* Detail */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {/* Meta summary */}
                    <p className="text-zinc-500 text-xs truncate">
                      <MetaSummary action={entry.action} meta={entry.meta} />
                    </p>
                    {/* Timestamp + IP */}
                    <p className="text-zinc-700 text-xs tabular-nums">
                      {formatTimestamp(entry.createdAt)}
                      {entry.ipAddress && (
                        <span className="ml-2 text-zinc-800">{entry.ipAddress}</span>
                      )}
                    </p>
                  </div>

                  {/* Affected lead count */}
                  {entry.leadIds && entry.leadIds.length > 0 && (
                    <span className="shrink-0 text-zinc-700 text-xs tabular-nums">
                      {entry.leadIds.length} lead{entry.leadIds.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
