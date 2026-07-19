/**
 * app/dashboard/components/LeadTable.tsx — Paginated, filterable lead table
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM)
 * Updated: 2026-07-19 by agent (Task #37 — Bulk status updates)
 *
 * Client Component. Receives server-fetched lead data as props.
 * Manages local state for:
 *   - Which lead's detail panel is open
 *   - Optimistic status updates (inline dropdown)
 *   - Checkbox selection + bulk action bar
 *
 * Security:
 *   - Lead emails rendered as text nodes — no dangerouslySetInnerHTML
 *   - Status updates via Server Actions (updateLead / bulkUpdateLeads) which
 *     both require owner auth server-side
 *   - No client-side authorization logic — all guards are server-side
 *
 * HUMAN REVIEW NOTES:
 * - Pagination is URL-param based; page changes trigger full server re-renders.
 * - Inline status select calls updateLead Server Action directly (single update).
 * - Bulk action bar appears when ≥1 rows are checked; calls bulkUpdateLeads.
 * - Notes are truncated to 60 chars in the table; full view is in LeadDetailPanel.
 * - Selecting all via the header checkbox selects only the current page (not all pages).
 */

"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition, useCallback } from "react";
import type { WaitlistEntry } from "@/db/schema";
import { updateLead, bulkUpdateLeads } from "@/app/actions/crm.actions";
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

  // ── Bulk selection state ───────────────────────────────────────────────────
  /** Set of lead IDs currently checked. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Status value chosen in the bulk action bar dropdown. */
  const [bulkStatus, setBulkStatus]   = useState<string>("");
  /** True while the bulkUpdateLeads Server Action is in flight. */
  const [isBulking,  setIsBulking]    = useState(false);
  /** Human-readable error from the last bulk attempt. */
  const [bulkError,  setBulkError]    = useState<string | null>(null);

  // Sync local entries when server re-renders with new props (e.g. after page nav).
  // Guard with savingId to avoid clobbering an in-flight optimistic update.
  if (entries !== localEntries && !savingId) {
    setLocalEntries(entries);
    // Clear selection when the page data changes — prevents stale IDs.
    setSelectedIds(new Set());
    setBulkError(null);
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
   * This is the single-row inline select; the bulk path is handleBulkApply.
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

  // ── Checkbox helpers ───────────────────────────────────────────────────────

  /**
   * toggleRow — check or uncheck a single lead row.
   */
  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkError(null);
  };

  /**
   * toggleAll — select or deselect all rows on the current page.
   * Does NOT select leads on other pages (that would require a separate query).
   */
  const toggleAll = () => {
    const allIdsOnPage = localEntries.map((e) => e.id);
    const allSelected  = allIdsOnPage.every((id) => selectedIds.has(id));

    if (allSelected) {
      // Deselect all on this page
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allIdsOnPage.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      // Select all on this page
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allIdsOnPage.forEach((id) => next.add(id));
        return next;
      });
    }
    setBulkError(null);
  };

  /**
   * handleBulkApply — Send bulkUpdateLeads Server Action for the selected IDs.
   *
   * Steps:
   *   1. Validate a status has been chosen
   *   2. Optimistically update local state
   *   3. Call Server Action
   *   4. Confirm or revert based on result
   *   5. Clear selection on success
   */
  const handleBulkApply = async () => {
    if (!bulkStatus) {
      setBulkError("Choose a status before applying.");
      return;
    }
    if (selectedIds.size === 0) return;

    setIsBulking(true);
    setBulkError(null);

    const ids = [...selectedIds];

    // Snapshot the previous statuses so we can revert on failure.
    const prevStatuses = new Map<string, string>(
      localEntries
        .filter((e) => selectedIds.has(e.id))
        .map((e) => [e.id, e.status]),
    );

    // Optimistic update — immediately reflect the new status in the table.
    setLocalEntries((prev) =>
      prev.map((e) =>
        selectedIds.has(e.id) ? { ...e, status: bulkStatus } : e,
      ),
    );

    const result = await bulkUpdateLeads({ ids, status: bulkStatus });

    if (result.success) {
      // Clear selection and reset the bulk dropdown on success.
      setSelectedIds(new Set());
      setBulkStatus("");
    } else {
      // Revert optimistic updates on failure.
      setLocalEntries((prev) =>
        prev.map((e) =>
          prevStatuses.has(e.id)
            ? { ...e, status: prevStatuses.get(e.id)! }
            : e,
        ),
      );
      setBulkError(result.error ?? "Bulk update failed — please try again.");
      console.error("[LeadTable] bulk update failed:", result.error);
    }

    setIsBulking(false);
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const allOnPageSelected =
    localEntries.length > 0 &&
    localEntries.every((e) => selectedIds.has(e.id));

  const someOnPageSelected =
    !allOnPageSelected && localEntries.some((e) => selectedIds.has(e.id));

  const selectionCount = selectedIds.size;

  // ── Empty state ────────────────────────────────────────────────────────────

  if (localEntries.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10 text-center">
        <p className="text-zinc-500 text-sm">No leads match the current filters.</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Bulk action bar (visible only when ≥1 rows selected) ── */}
      {selectionCount > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-zinc-700/60 bg-zinc-800/80 backdrop-blur-sm"
        >
          {/* Selection count */}
          <span className="text-xs text-zinc-400 shrink-0 tabular-nums">
            <span className="font-semibold text-zinc-200">{selectionCount}</span>{" "}
            {selectionCount === 1 ? "lead" : "leads"} selected
          </span>

          <div className="flex-1" />

          {/* Status picker */}
          <label htmlFor="bulk-status-select" className="sr-only">
            New status for selected leads
          </label>
          <select
            id="bulk-status-select"
            value={bulkStatus}
            onChange={(e) => { setBulkStatus(e.target.value); setBulkError(null); }}
            disabled={isBulking}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-700 border border-zinc-600 text-zinc-200
                       focus:outline-none focus:ring-1 focus:ring-zinc-400/40 cursor-pointer
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="" disabled>Set status…</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Apply button */}
          <button
            type="button"
            onClick={handleBulkApply}
            disabled={isBulking || !bulkStatus}
            aria-busy={isBulking}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-200 text-zinc-900 font-medium
                       hover:bg-white transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBulking
              ? "Applying…"
              : `Apply to ${selectionCount} ${selectionCount === 1 ? "lead" : "leads"}`}
          </button>

          {/* Clear selection */}
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); setBulkError(null); }}
            disabled={isBulking}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bulk error message */}
      {bulkError && (
        <p role="alert" className="text-xs text-red-400 px-1">
          {bulkError}
        </p>
      )}

      {/* ── Main table ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        {/* Table header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
          {/* Select-all checkbox */}
          <input
            type="checkbox"
            aria-label="Select all leads on this page"
            checked={allOnPageSelected}
            ref={(el) => {
              // Use the indeterminate DOM property for the "some but not all" state.
              if (el) el.indeterminate = someOnPageSelected;
            }}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-zinc-300
                       accent-zinc-400 cursor-pointer shrink-0"
          />
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex-1">
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
          {localEntries.map((entry) => {
            const isChecked = selectedIds.has(entry.id);
            return (
              <div
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-3 transition-colors group
                  ${isChecked
                    ? "bg-zinc-800/50"
                    : "hover:bg-zinc-800/30"
                  }`}
              >
                {/* Row checkbox */}
                <input
                  type="checkbox"
                  aria-label={`Select lead ${entry.email}`}
                  checked={isChecked}
                  onChange={() => toggleRow(entry.id)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-zinc-300
                             accent-zinc-400 cursor-pointer shrink-0"
                />

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
                    disabled={savingId === entry.id || isBulking}
                    aria-label={`Status for ${entry.email}`}
                    className={`
                      text-xs px-2.5 py-1 rounded-lg border-0 focus:outline-none focus:ring-1 focus:ring-zinc-500/30
                      cursor-pointer appearance-none pr-6
                      ${STATUS_COLORS[entry.status] ?? STATUS_COLORS.new}
                      ${(savingId === entry.id || isBulking) ? "opacity-50 cursor-not-allowed" : ""}
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
            );
          })}
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
