/**
 * ProcessingStepper.tsx — Live "assembly line" view of the episode pipeline
 *
 * Part of: PodLever
 * Created: 2026-07-26
 * Last modified: 2026-07-26 by agent (pipeline visibility)
 *
 * Replaces the mystery spinner with a stage-by-stage stepper:
 *   Queued → Fetching audio → Enhancing → Transcribing → Writing content
 *   → Packaging → Ready
 *
 * Also shows queue position when other episodes are ahead in line, surfaces
 * the exact failure message when a stage dies, and offers a Retry button
 * that pulls the job forward immediately (no waiting out backoff timers).
 *
 * Polls via router.refresh() every 5s while processing (same pattern the old
 * StatusPoller used) — the server component re-reads stage/queue each cycle.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, Circle, AlertTriangle, RotateCcw, ListOrdered } from "lucide-react";
import { retryProcessingAction } from "@/app/actions/episode.actions";

/** Pipeline stages in assembly-line order. Keys match episodes.processing_stage. */
const STAGES: { key: string; label: string; detail: string }[] = [
  { key: "queued",       label: "Queued",          detail: "Waiting for a free slot on the assembly line" },
  { key: "downloading",  label: "Fetching audio",  detail: "Pulling your file from storage" },
  { key: "enhancing",    label: "Enhancing audio", detail: "Cleaning up the sound (skipped for video/large files)" },
  { key: "transcribing", label: "Transcribing",    detail: "Compressing and converting speech to text" },
  { key: "generating",   label: "Writing content", detail: "Show notes, blog post, social copy, media pack" },
  { key: "packaging",    label: "Packaging",       detail: "Building the guest media pack PDF" },
];

interface Props {
  episodeId: string;
  /** Current episode FSM state. */
  state: string;
  /** Current pipeline stage (episodes.processing_stage) or null. */
  stage: string | null;
  /** Most recent failure message (episodes.processing_error) or null. */
  error: string | null;
  /** 1-based position in line when other episodes are ahead; 0 = up now. */
  queuePosition: number;
  /** Titles of episodes ahead in line, in order. */
  aheadTitles: string[];
  /** Polling interval ms. */
  intervalMs?: number;
}

export function ProcessingStepper({
  episodeId, state, stage, error, queuePosition, aheadTitles, intervalMs = 5000,
}: Props) {
  const router = useRouter();
  const [retryPending, startRetry] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "processing") return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [state, intervalMs, router]);

  if (state !== "processing") return null;

  // Where are we on the line? No stage yet = still queued.
  const effectiveKey  = stage ?? "queued";
  const activeIdx     = Math.max(0, STAGES.findIndex((s) => s.key === effectiveKey));
  const inLine        = queuePosition > 0 && !stage;

  function handleRetry() {
    setRetryError(null);
    startRetry(async () => {
      const res = await retryProcessingAction(episodeId);
      if (!res.ok) setRetryError(res.error ?? "Retry failed.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
      {/* Header strip */}
      <div className={`px-5 py-3 border-b flex items-center gap-2.5 ${
        error ? "bg-red-50 border-red-100" : "bg-amber-50 border-amber-100"
      }`}>
        {error ? (
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
        ) : (
          <Loader2 className="w-5 h-5 animate-spin text-amber-500 shrink-0" />
        )}
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${error ? "text-red-800" : "text-amber-800"}`}>
            {error
              ? `Hit a snag while ${STAGES[activeIdx]?.label.toLowerCase() ?? "processing"} — retrying automatically`
              : inLine
                ? `In line — #${queuePosition + 1} on the assembly line`
                : `${STAGES[activeIdx]?.label ?? "Processing"}…`}
          </p>
          <p className={`text-xs mt-0.5 ${error ? "text-red-600" : "text-amber-600"}`}>
            {error
              ? error
              : inLine
                ? `Ahead of this episode: ${aheadTitles.length > 0 ? aheadTitles.join(", ") : `${queuePosition} episode${queuePosition === 1 ? "" : "s"}`}`
                : STAGES[activeIdx]?.detail ?? "Working…"}
          </p>
        </div>
        {error && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={retryPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700
                       disabled:opacity-60 px-3 py-1.5 text-xs font-semibold text-white transition-colors shrink-0"
          >
            {retryPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RotateCcw className="w-3.5 h-3.5" />}
            Retry now
          </button>
        )}
      </div>

      {retryError && (
        <p className="px-5 pt-3 text-xs text-red-600">{retryError}</p>
      )}

      {/* Assembly line */}
      <ol className="px-5 py-4 space-y-2.5">
        {STAGES.map((s, i) => {
          const done   = i < activeIdx;
          const active = i === activeIdx;
          return (
            <li key={s.key} className="flex items-center gap-3">
              {done ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              ) : active ? (
                error
                  ? <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                  : <Loader2 className="w-5 h-5 animate-spin text-indigo-500 shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-gray-300 shrink-0" />
              )}
              <div className="min-w-0">
                <p className={`text-sm ${
                  done ? "text-gray-400 line-through decoration-gray-300"
                       : active ? (error ? "font-semibold text-red-700" : "font-semibold text-gray-900")
                       : "text-gray-400"
                }`}>
                  {s.label}
                </p>
                {active && !error && (
                  <p className="text-xs text-gray-500">{s.detail}</p>
                )}
              </div>
            </li>
          );
        })}
        {/* Final step: Ready */}
        <li className="flex items-center gap-3">
          <Circle className="w-5 h-5 text-gray-300 shrink-0" />
          <p className="text-sm text-gray-400">Ready — review your content suite</p>
        </li>
      </ol>

      {inLine && aheadTitles.length > 0 && (
        <div className="px-5 pb-4 flex items-start gap-2 text-xs text-gray-500">
          <ListOrdered className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
          <p>
            Episodes are processed one at a time, in upload order. This one starts
            automatically when {aheadTitles.length === 1 ? `“${aheadTitles[0]}” is` : "the episodes ahead are"} done.
          </p>
        </div>
      )}
    </div>
  );
}
