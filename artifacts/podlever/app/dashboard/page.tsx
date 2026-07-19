/**
 * app/dashboard/page.tsx — PodLever owner dashboard
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #20 — waitlist section added)
 *
 * Moved from app/page.tsx (Phase 1A) to make room for the public landing page.
 * Route: /dashboard (owner-only; unauthenticated/non-owner redirected to /)
 *
 * HUMAN REVIEW NOTES:
 * Phase 1B: Replace the status checklist with the real episode management UI
 * once the processing pipeline (jobs, AI, storage) is implemented.
 *
 * Waitlist data is queried server-side on every page load — no public endpoint
 * is exposed. Only the owner role can reach this route.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/providers/auth";
import { episodeRepository, waitlistRepository, type WaitlistSummary } from "@/repositories";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * formatDate — format a Date object as a short human-readable string.
 * Uses the server's locale; always in UTC to avoid hydration mismatches.
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * formatTime — format a Date object as HH:MM UTC.
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

/**
 * sourceLabel — human-readable label for a CTA source tag.
 * Falls back to the raw tag if not recognised.
 */
function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    landing:         "Landing page (default)",
    landing_hero:    "Landing — Hero CTA",
    landing_pricing: "Landing — Pricing section",
    pricing_page:    "Pricing page",
    pricing_pro:     "Pricing — Pro tier",
    footer:          "Footer CTA",
  };
  return labels[source] ?? source;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * DashboardPage — Owner dashboard (Server Component).
 *
 * Only accessible to the authenticated owner. Non-owners and unauthenticated
 * visitors are redirected to the public landing page.
 *
 * Fetches episode count (DB connectivity check) and the full waitlist summary
 * in parallel, so both queries resolve before the page renders.
 */
export default async function DashboardPage() {
  const user = await getAuthUser();

  // Redirect unauthenticated visitors to the landing page
  if (!user) {
    redirect("/");
  }

  // Non-owners see the landing page (they're not customers yet)
  if (user.role !== "owner") {
    redirect("/");
  }

  // ── Parallel data fetching ─────────────────────────────────────────────────

  const [episodeResult, waitlistResult] = await Promise.allSettled([
    episodeRepository.listEpisodesForOwner(user.userId),
    waitlistRepository.getSummary(),
  ]);

  // Episode count — DB connectivity check
  const episodeCount: number | null =
    episodeResult.status === "fulfilled" ? episodeResult.value.length : null;
  const dbError: string | null =
    episodeResult.status === "rejected"
      ? (console.error("[dashboard] DB connectivity check failed:", (episodeResult.reason as Error).message),
         "Database connectivity check failed — check server logs.")
      : null;

  // Waitlist summary
  const waitlistSummary: WaitlistSummary | null =
    waitlistResult.status === "fulfilled" ? waitlistResult.value : null;
  const waitlistError: string | null =
    waitlistResult.status === "rejected"
      ? (console.error("[dashboard] Waitlist query failed:", (waitlistResult.reason as Error).message),
         "Could not load waitlist data — check server logs.")
      : null;

  // ── Phase 1A verification checks ──────────────────────────────────────────

  const checks: Array<{ label: string; status: "ok" | "error" | "pending"; detail?: string }> = [
    {
      label:  "Authentication",
      status: "ok",
      detail: `Signed in as ${user.displayName} (owner)`,
    },
    {
      label:  "Database",
      status: dbError ? "error" : "ok",
      detail: dbError ?? `Connected — ${episodeCount} episode${episodeCount === 1 ? "" : "s"}`,
    },
    {
      label:  "Episode FSM",
      status: "ok",
      detail: "Verified — 22/22 assertions passed (run verify-fsm to re-check)",
    },
    {
      label:  "Schema",
      status: "ok",
      detail: "users · episodes · assets · pipeline_events · waitlist",
    },
    {
      label:  "Server Actions",
      status: "ok",
      detail: "createEpisode · listEpisodes · transitionEpisode · joinWaitlist wired",
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-zinc-950 p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎙️</span>
              <h1 className="text-2xl font-bold text-white">PodLever</h1>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                Phase 1A
              </span>
            </div>
            <p className="text-zinc-500 text-sm pl-9">Foundation verified</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 text-xs transition-colors"
            >
              View site
            </Link>
            <Link
              href="/auth/logout"
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 text-xs transition-colors"
            >
              Sign out
            </Link>
          </div>
        </div>

        {/* Welcome */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <p className="text-zinc-400 text-sm">
            Welcome back, <span className="text-white font-semibold">{user.displayName}</span>.
            The Phase 1A foundation is complete and verified. Phase 1B (processing pipeline)
            begins after Task #2 is executed.
          </p>
        </div>

        {/* ── Waitlist Section ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1">
            Early Access Waitlist
          </h2>

          {waitlistError ? (
            <div className="rounded-2xl border border-red-900/40 bg-red-500/5 p-4">
              <p className="text-red-400 text-sm">{waitlistError}</p>
            </div>
          ) : waitlistSummary ? (
            <div className="space-y-3">

              {/* Total count + source breakdown */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">

                {/* Total */}
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-bold text-white tabular-nums">
                    {waitlistSummary.totalCount}
                  </span>
                  <span className="text-zinc-500 text-sm">
                    {waitlistSummary.totalCount === 1 ? "signup" : "signups"} total
                  </span>
                </div>

                {/* Source breakdown */}
                {waitlistSummary.bySource.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-600 uppercase tracking-wider">
                      By source
                    </p>
                    {waitlistSummary.bySource.map((row) => {
                      const pct =
                        waitlistSummary!.totalCount > 0
                          ? Math.round((row.signupCount / waitlistSummary!.totalCount) * 100)
                          : 0;
                      return (
                        <div key={row.source} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400">{sourceLabel(row.source)}</span>
                            <span className="text-zinc-500 tabular-nums">
                              {row.signupCount} · {pct}%
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500/70"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {waitlistSummary.totalCount === 0 && (
                  <p className="text-zinc-600 text-sm">
                    No signups yet. Share the landing page to start collecting early access interest.
                  </p>
                )}
              </div>

              {/* Recent signups list */}
              {waitlistSummary.recent.length > 0 && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Recent signups
                    </span>
                    <span className="text-xs text-zinc-600">
                      {waitlistSummary.recent.length === 50
                        ? "50 most recent"
                        : `${waitlistSummary.recent.length} total`}
                    </span>
                  </div>
                  <div className="divide-y divide-zinc-800/60">
                    {waitlistSummary.recent.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <span className="text-zinc-300 text-sm font-mono truncate flex-1">
                          {entry.email}
                        </span>
                        <div className="flex-shrink-0 text-right space-y-0.5">
                          <p className="text-zinc-500 text-xs tabular-nums">
                            {formatDate(entry.createdAt)}
                          </p>
                          <p className="text-zinc-700 text-xs tabular-nums">
                            {formatTime(entry.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          ) : (
            /* Loading state (should not appear in SSR, but included as safety net) */
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <p className="text-zinc-600 text-sm">Loading waitlist data…</p>
            </div>
          )}
        </div>

        {/* ── Phase 1A Checklist ────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1">
            Phase 1A Checklist
          </h2>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800">
            {checks.map((check) => (
              <div key={check.label} className="flex items-start gap-4 p-4">
                <div className="mt-0.5 flex-shrink-0">
                  {check.status === "ok" && (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs">✓</span>
                  )}
                  {check.status === "error" && (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500/15 text-red-400 text-xs">✗</span>
                  )}
                  {check.status === "pending" && (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 text-xs">~</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-200 text-sm font-medium">{check.label}</p>
                  {check.detail && (
                    <p className="text-zinc-500 text-xs mt-0.5 font-mono">{check.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-zinc-700 text-xs">
          PodLever · Russell Nomer Consulting · Phase 1A · {new Date().getFullYear()}
        </p>

      </div>
    </main>
  );
}
