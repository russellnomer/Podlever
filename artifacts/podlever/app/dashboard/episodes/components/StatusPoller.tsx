/**
 * StatusPoller.tsx — Polls episode status while processing is in flight
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #2 — Episode processing pipeline)
 *
 * When the episode is in "processing" state this client component calls
 * router.refresh() every 5 seconds. Next.js App Router refresh re-fetches
 * the Server Component tree and re-renders the detail page with the latest
 * episode state — no manual polling API needed.
 *
 * Stops polling automatically once the episode leaves "processing" state.
 */

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 }   from "lucide-react";

interface Props {
  /** Current episode state as read by the server component. */
  state: string;
  /** Polling interval in milliseconds (default: 5000). */
  intervalMs?: number;
}

export function StatusPoller({ state, intervalMs = 5000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (state !== "processing") return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [state, intervalMs, router]);

  if (state !== "processing") return null;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 text-amber-800">
      <Loader2 className="w-5 h-5 animate-spin text-amber-500 shrink-0" />
      <div>
        <p className="font-medium text-sm">Processing your episode…</p>
        <p className="text-xs text-amber-600 mt-0.5">
          Transcribing audio and generating assets. This usually takes 1–3 minutes.
          This page will update automatically.
        </p>
      </div>
    </div>
  );
}
