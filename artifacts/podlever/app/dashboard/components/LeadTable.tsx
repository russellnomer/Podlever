/**
 * app/dashboard/components/LeadTable.tsx — Paginated, filterable lead table
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM)
 *
 * Client Component. Receives server-fetched lead data as props.
 * Manages local state for:
 *   - Which lead's detail panel is open
 *   - Optimistic status updates (inline dropdown)
 *
 * Security:
 *   - Lead emails rendered as text nodes — no dangerouslySetInnerHTML
 *   - Status updates via Server Action (updateLead) which requires owner auth
 *   - No client-side authorization logic — all guards are server-side
 *
 * HUMAN REVIEW NOTES:
 * - Pagination is URL-param based; page changes trigger full server re-renders.
 * - Inline status select calls updateLead Server Action directly.
 * - Notes are truncated to 60 chars in the table; full view is in LeadDetailPanel.
 */

"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition, useCallback } from "react";
import type { WaitlistEntry } from "@/db/schema";
import { updateLead } from "@/app/actions/crm.actions";
import { LeadDetailPanel } from "./LeadDetailPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadTableProps {
  entries:  WaitlistEntry[];
  total:    number;
  page:     number;
  pageSize: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new:          "bg-zinc-700/50 text-zinc-300",
  contacted:    "bg-blue-500/15 text-blue-300",
  qualified:    "bg-amber-500/15 text-amber-300",
  converted:    "bg-emerald-500/15 text-emerald-400",
  disqualified: "bg-red-500/10 text-red-400",
};

const STATUS_OPTIONS = [
  { value: "new",          label: "New" },
  { value: "contacted",    label: "Contacted" },
  { value: "qualified",    label: "Qualified" },
  { value: "converted",    label: "Converted" },
  { value: "disqualified", label: "Disqualified" },
];

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LeadTable({ entries, total, page, pageSize }: LeadTableProps) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local optimistic state for status updates
  const [localEntries, setLocalEntries] = useState<WaitlistEntry[]>(entries);
  const [detailLead, setDetailLead]     = useState<WaitlistEntry | null>(null);
  const [savingId,   setSavingId]       = useState<string | null>(null);

  // Sync local entries when server re-renders with new props
  if (entries !== localEntries && !savingId) {
    setLocalEntries(entries);
  }

  const totalPages = Math.ceil(total / pageSize);

  /**
   * navigatePage — update the `page` URL param and trigger server re-render.
   */
  const navigatePage = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(newPage));
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams],
  );

  /**
   * handleStatusChange — Optimistically update status then call Server Action.
   */
  const handleStatusChange = async (lead: WaitlistEntry, newStatus: string) => {
    if (newStatus === lead.status) return;

    setSavingId(lead.id);

    // Optimistic update — show new status immediately
    setLocalEntries((prev) =>
      prev.map((e) => e.id === lead.id ? { ...e, status: newStatus } : e),
    );

    const result = await updateLead({ id: lead.id, status: newStatus });

    if (result.success) {
      // Replace with server-confirmed data
      setLocalEntries((prev) =>
        prev.map((e) => e.id === lead.id ? result.data : e),
      );
      // Update detail panel if open
      if (detailLead?.id === lead.id) {
        setDetailLead(result.data);
      }
    } else {
      // Revert optimistic update on failure
      setLocalEntries((prev) =>
        prev.map((e) => e.id === lead.id ? lead : e),
      );
      console.error("[LeadTable] status update failed:", result.error);
    }

    setSavingId(null);
  };

  if (localEntries.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10 text-center">
        <p className="text-zinc-500 text-sm">No leads match the current filters.</p>
      </div>
    );
  }

  return (
    <>
      {/* Table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        {/* Table header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Leads
          </span>
          <span className="text-xs text-zinc-600 tabular-nums">
            {total} total · page {page} of {totalPages}
            {isPending && (
              <span className="ml-2 text-zinc-700">loading…</span>
            )}
          </span>
        </div>

        {/* Rows */}
        <div className="divide-y divide-zinc-800/60">
          {localEntries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors group"
            >
              {/* Email — text node, no dangerouslySetInnerHTML */}
              <div className="flex-1 min-w-0">
                <p className="text-zinc-200 text-sm font-mono truncate">
                  {entry.email}
                </p>
                {entry.notes && (
                  <p className="text-zinc-600 text-xs mt-0.5 truncate">
                    {entry.notes.length > 60
                      ? entry.notes.slice(0, 60) + "…"
                      : entry.notes}
                  </p>
                )}
              </div>

              {/* Source badge */}
              <span className="hidden sm:block text-zinc-600 text-xs px-2 py-0.5 rounded bg-zinc-800/50 shrink-0">
                {entry.source}
              </span>

              {/* Status inline select */}
              <div className="relative shrink-0">
                <select
                  value={entry.status}
                  onChange={(e) => handleStatusChange(entry, e.target.value)}
                  disabled={savingId === entry.id}
                  aria-label={`Status for ${entry.email}`}
                  className={`
                    text-xs px-2.5 py-1 rounded-lg border-0 focus:outline-none focus:ring-1 focus:ring-zinc-500/30
                    cursor-pointer appearance-none pr-6
                    ${STATUS_COLORS[entry.status] ?? STATUS_COLORS.new}
                    ${savingId === entry.id ? "opacity-50 cursor-not-allowed" : ""}
                  `}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-1.5 flex items-center pointer-events-none">
                  <svg className="w-3 h-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Signed-up date */}
              <span className="hidden md:block text-zinc-600 text-xs tabular-nums shrink-0">
                {formatDate(entry.createdAt)}
              </span>

              {/* Edit button — opens detail panel */}
              <button
                type="button"
                onClick={() => setDetailLead(entry)}
                className="opacity-0 group-hover:opacity-100 shrink-0 px-2 py-1 rounded-lg text-zinc-500 hover:text-zinc-300 text-xs transition-all"
                aria-label={`Edit lead`}
              >
                Edit
              </button>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigatePage(page - 1)}
              disabled={page <= 1 || isPending}
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>
            <span className="text-xs text-zinc-600 tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => navigatePage(page + 1)}
              disabled={page >= totalPages || isPending}
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Lead detail slide-over panel */}
      {detailLead && (
        <LeadDetailPanel
          lead={detailLead}
          onClose={() => setDetailLead(null)}
          onSaved={(updated) => {
            setLocalEntries((prev) =>
              prev.map((e) => e.id === updated.id ? updated : e),
            );
            setDetailLead(updated);
          }}
        />
      )}
    </>
  );
}
