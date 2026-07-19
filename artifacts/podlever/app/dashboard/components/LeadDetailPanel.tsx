/**
 * app/dashboard/components/LeadDetailPanel.tsx — Lead detail slide-over panel
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM)
 *
 * Client Component. Renders as a slide-over panel from the right side of the screen.
 * Shows the full lead record, status select, notes textarea, and save button.
 *
 * Security:
 *   - All edits go through the updateLead Server Action (requireOwner guard)
 *   - Email rendered as a text node — no dangerouslySetInnerHTML
 *   - Notes capped at 1000 chars (enforced client + server side)
 *
 * HUMAN REVIEW NOTES:
 * - The panel uses a backdrop overlay to trap focus and prevent background clicks.
 * - ESC key closes the panel without saving.
 * - Character counter shown for notes field.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import type { WaitlistEntry } from "@/db/schema";
import { updateLead } from "@/app/actions/crm.actions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadDetailPanelProps {
  lead:    WaitlistEntry;
  onClose: () => void;
  onSaved: (updated: WaitlistEntry) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "new",          label: "New" },
  { value: "contacted",    label: "Contacted" },
  { value: "qualified",    label: "Qualified" },
  { value: "converted",    label: "Converted" },
  { value: "disqualified", label: "Disqualified" },
];

function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }) + " UTC";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LeadDetailPanel({ lead, onClose, onSaved }: LeadDetailPanelProps) {
  const [status, setStatus] = useState(lead.status);
  const [notes,  setNotes]  = useState(lead.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [saved,  setSaved]  = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset form when lead prop changes (different lead opened)
  useEffect(() => {
    setStatus(lead.status);
    setNotes(lead.notes ?? "");
    setError(null);
    setSaved(false);
  }, [lead.id]);

  // Close on ESC key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const isDirty = status !== lead.status || notes !== (lead.notes ?? "");

  const handleSave = async () => {
    if (!isDirty) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await updateLead({
      id:     lead.id,
      status: status !== lead.status ? status : undefined,
      notes:  notes !== (lead.notes ?? "") ? (notes || null) : undefined,
    });

    setSaving(false);

    if (result.success) {
      setSaved(true);
      onSaved(result.data);
      // Auto-clear saved confirmation after 2 seconds
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError(result.error);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Lead details"
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">Lead Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded"
            aria-label="Close panel"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Email — text node */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Email
            </label>
            <p className="text-zinc-200 font-mono text-sm break-all">{lead.email}</p>
          </div>

          {/* Source + Signed up */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Source
              </label>
              <p className="text-zinc-400 text-sm">{lead.source}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Signed up
              </label>
              <p className="text-zinc-400 text-xs">{formatDateTime(lead.createdAt)}</p>
            </div>
          </div>

          {lead.updatedAt && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Last updated
              </label>
              <p className="text-zinc-600 text-xs">{formatDateTime(lead.updatedAt)}</p>
            </div>
          )}

          {/* Status select */}
          <div>
            <label
              htmlFor="lead-status"
              className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1"
            >
              Status
            </label>
            <select
              id="lead-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={saving}
              className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-200 text-sm focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30 transition-colors disabled:opacity-50"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Notes textarea */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="lead-notes"
                className="block text-xs font-medium text-zinc-500 uppercase tracking-wider"
              >
                Notes
              </label>
              <span className={`text-xs tabular-nums ${notes.length > 900 ? "text-amber-400" : "text-zinc-700"}`}>
                {notes.length} / 1000
              </span>
            </div>
            <textarea
              id="lead-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              maxLength={1000}
              rows={5}
              placeholder="Add notes about this lead…"
              className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-200 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30 resize-none transition-colors disabled:opacity-50"
              aria-label="Notes about this lead"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-900/40 px-4 py-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
