/**
 * app/dashboard/components/ExportButton.tsx — Rate-limited CSV export control
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM)
 *
 * Client Component. Fetches the current export rate limit status on mount,
 * shows the remaining export count, and initiates a browser download by
 * navigating to the streaming export Route Handler.
 *
 * Security:
 *   - The actual auth + rate limit enforcement is in the Route Handler.
 *     This component is display-only — it cannot bypass server-side checks.
 *   - No data is fetched or cached client-side.
 *   - The export URL is opened in the same tab (window.location.href) so the
 *     browser's native file-download flow handles the streaming response.
 *
 * HUMAN REVIEW NOTES:
 * - Rate limit check (checkExportLimit) is a Server Action that peeks without
 *   consuming a slot — safe to call on mount and after each export.
 * - The actual export Route Handler at /rpc/crm/export enforces the rate limit
 *   atomically and logs to crm_audit_log.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { checkExportLimit } from "@/app/actions/crm.actions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExportButtonProps {
  /** Current active filter params — forwarded to the export URL as query string */
  filterParams: string;
  /** Number of leads that will be exported (total matching current filters) */
  matchingCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExportButton({ filterParams, matchingCount }: ExportButtonProps) {
  const [remaining, setRemaining]   = useState<number | null>(null);
  const [resetAt,   setResetAt]     = useState<number | null>(null);
  const [loading,   setLoading]     = useState(true);
  const [exporting, setExporting]   = useState(false);

  /**
   * refreshLimit — Peek at the export rate limit without consuming a slot.
   * Called on mount and after each export.
   */
  const refreshLimit = useCallback(async () => {
    const result = await checkExportLimit();
    if (result.success) {
      setRemaining(result.data.remaining);
      setResetAt(result.data.resetAt);
    } else {
      setRemaining(0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshLimit();
  }, [refreshLimit]);

  const handleExport = async () => {
    if (!remaining || remaining <= 0 || exporting) return;

    setExporting(true);

    // Build export URL with current filter params
    const exportUrl = filterParams
      ? `/rpc/crm/export?${filterParams}`
      : `/rpc/crm/export`;

    // Navigate to the Route Handler — browser handles the file download
    window.location.href = exportUrl;

    // Refresh limit status after a short delay (the Route Handler consumes a slot)
    setTimeout(async () => {
      await refreshLimit();
      setExporting(false);
    }, 1500);
  };

  // Format the reset time as a human-readable "resets in Xh Ym" string
  const resetIn = resetAt
    ? (() => {
        const ms = resetAt - Date.now();
        if (ms <= 0) return null;
        const totalMinutes = Math.ceil(ms / 60_000);
        const hours   = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
      })()
    : null;

  const canExport = !loading && remaining !== null && remaining > 0;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={handleExport}
        disabled={!canExport || exporting}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm hover:bg-zinc-700 hover:border-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={`Export ${matchingCount} leads as CSV`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        {exporting ? "Exporting…" : `Export CSV (${matchingCount} leads)`}
      </button>

      {/* Rate limit indicator */}
      {!loading && remaining !== null && (
        <span className={`text-xs tabular-nums ${remaining === 0 ? "text-red-400" : "text-zinc-600"}`}>
          {remaining === 0
            ? `Rate limit reached${resetIn ? ` · resets in ${resetIn}` : ""}`
            : `${remaining} of 3 exports remaining this hour`}
        </span>
      )}
    </div>
  );
}
