/**
 * app/dashboard/components/CrmFilters.tsx — CRM search and filter controls
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM)
 *
 * Client Component. Updates URL search params to trigger a server-side re-render
 * of the parent page with filtered + paginated results.
 *
 * Security:
 *   - All values sent via URL params are re-validated server-side (crm.actions.ts)
 *   - No server requests made directly from this component — all filtering is
 *     triggered by URL param changes which cause a full server re-render
 *
 * HUMAN REVIEW NOTES:
 * - Debounce is applied to the search input to avoid flooding navigation events.
 * - All form values go through the server's FilterSchema before reaching the DB.
 * - No PII is extracted or stored client-side.
 */

"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CrmFiltersProps {
  /** All distinct source values in the database — used to populate the source dropdown */
  sources: string[];
  /** Current active filter values (from URL params) */
  currentSearch:   string;
  currentSource:   string;
  currentStatus:   string;
  currentDateFrom: string;
  currentDateTo:   string;
  currentPageSize: string;
}

const STATUS_OPTIONS = [
  { value: "",              label: "All statuses" },
  { value: "new",          label: "New" },
  { value: "contacted",    label: "Contacted" },
  { value: "qualified",    label: "Qualified" },
  { value: "converted",    label: "Converted" },
  { value: "disqualified", label: "Disqualified" },
];

const PAGE_SIZE_OPTIONS = [
  { value: "25",  label: "25 / page" },
  { value: "50",  label: "50 / page" },
  { value: "100", label: "100 / page" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function CrmFilters({
  sources,
  currentSearch,
  currentSource,
  currentStatus,
  currentDateFrom,
  currentDateTo,
  currentPageSize,
}: CrmFiltersProps) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local search state for debouncing
  const [searchValue, setSearchValue] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when URL params change externally (e.g. pagination nav)
  useEffect(() => {
    setSearchValue(currentSearch);
  }, [currentSearch]);

  /**
   * updateParam — Update a single URL search param and navigate.
   *
   * Resets `page` to 1 whenever a filter changes (avoid showing page 3 of
   * a newly filtered result that may only have 1 page).
   */
  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Always reset to page 1 when any filter changes
      if (key !== "page" && key !== "pageSize") {
        params.delete("page");
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams],
  );

  /**
   * handleSearch — Debounced search handler.
   *
   * Waits 400ms after the user stops typing before triggering navigation.
   * Prevents a server request per keystroke.
   */
  const handleSearch = (value: string) => {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParam("search", value);
    }, 400);
  };

  /** clearAllFilters — reset all filter params and return to page 1 */
  const clearAllFilters = () => {
    startTransition(() => {
      router.push(pathname);
    });
    setSearchValue("");
  };

  const hasActiveFilters =
    currentSearch || currentSource || currentStatus || currentDateFrom || currentDateTo;

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search by email…"
          value={searchValue}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-200 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30 transition-colors"
          maxLength={320}
          aria-label="Search leads by email"
        />
        {isPending && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-2">
        {/* Source filter */}
        <select
          value={currentSource}
          onChange={(e) => updateParam("source", e.target.value)}
          className="flex-1 min-w-[130px] px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 text-xs focus:outline-none focus:border-zinc-500 transition-colors"
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={currentStatus}
          onChange={(e) => updateParam("status", e.target.value)}
          className="flex-1 min-w-[130px] px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 text-xs focus:outline-none focus:border-zinc-500 transition-colors"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Date from */}
        <input
          type="date"
          value={currentDateFrom}
          onChange={(e) => updateParam("dateFrom", e.target.value)}
          className="flex-1 min-w-[130px] px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 text-xs focus:outline-none focus:border-zinc-500 transition-colors"
          aria-label="From date"
        />

        {/* Date to */}
        <input
          type="date"
          value={currentDateTo}
          onChange={(e) => updateParam("dateTo", e.target.value)}
          className="flex-1 min-w-[130px] px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 text-xs focus:outline-none focus:border-zinc-500 transition-colors"
          aria-label="To date"
        />

        {/* Page size */}
        <select
          value={currentPageSize || "25"}
          onChange={(e) => updateParam("pageSize", e.target.value)}
          className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 text-xs focus:outline-none focus:border-zinc-500 transition-colors"
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="px-3 py-2 rounded-lg border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 text-xs transition-colors"
            aria-label="Clear all filters"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
