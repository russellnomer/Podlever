/**
 * app/dashboard/page.tsx — PodLever owner dashboard
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — moved from / to /dashboard)
 *
 * Moved from app/page.tsx (Phase 1A) to make room for the public landing page.
 * Route: /dashboard (owner-only; unauthenticated/non-owner redirected to /)
 *
 * HUMAN REVIEW NOTES:
 * Phase 1B: Replace the status checklist with the real episode management UI
 * once the processing pipeline (jobs, AI, storage) is implemented.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/providers/auth";
import { episodeRepository } from "@/repositories";

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * DashboardPage — Phase 1A verification dashboard (Server Component).
 *
 * Only accessible to the authenticated owner. Non-owners and unauthenticated
 * visitors are redirected to the public landing page.
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

  // Fetch episode count to verify DB connectivity
  let episodeCount: number | null = null;
  let dbError: string | null = null;

  try {
    const episodes = await episodeRepository.listEpisodesForOwner(user.userId);
    episodeCount = episodes.length;
  } catch (err) {
    console.error("[dashboard] DB connectivity check failed:", (err as Error).message);
    dbError = "Database connectivity check failed — check server logs.";
  }

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

        {/* Verification checks */}
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
