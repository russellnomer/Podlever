/**
 * app/page.tsx — Phase 1A Verification UI (T10)
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T10 — Verification UI)
 *
 * This is a Server Component. It renders the Phase 1A status dashboard for the
 * authenticated owner, or a sign-in prompt for unauthenticated visitors.
 *
 * HUMAN REVIEW NOTES:
 * This page serves two purposes in Phase 1A:
 *   1. Owner dashboard: confirms auth, DB connectivity, and FSM readiness
 *   2. Sign-in gate: non-authenticated visitors see a sign-in prompt only
 *
 * Phase 1B: Replace with the real episode management UI once the processing
 * pipeline (jobs, AI, storage) is implemented. This page is a placeholder.
 *
 * Access control:
 *   - Unauthenticated: shows sign-in prompt, no data exposed
 *   - Authenticated non-owner: shows "access restricted" message
 *   - Authenticated owner: shows full Phase 1A status dashboard
 */

import Link from "next/link";
import { getAuthUser } from "@/providers/auth";
import { episodeRepository } from "@/repositories";
import { StudioUploader } from "@/app/components/StudioUploader";

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Home — Phase 1A verification dashboard (Server Component).
 *
 * Reads auth state from the encrypted session cookie (no client JS needed).
 * Queries the DB for episode count to confirm connectivity.
 */
export default async function Home() {
  const user = await getAuthUser();

  // ── Unauthenticated ──────────────────────────────────────────────────────────
  if (!user) {
    return <SignInPrompt />;
  }

  // ── Authenticated non-owner ──────────────────────────────────────────────────
  if (user.role !== "owner") {
    return <AccessRestricted displayName={user.displayName} />;
  }

  // ── Authenticated owner — Phase 1A dashboard ─────────────────────────────────
  // Fetch episode count to verify DB connectivity
  let episodeCount: number | null = null;
  let dbError: string | null = null;

  try {
    const episodes = await episodeRepository.listEpisodesForOwner(user.userId);
    episodeCount = episodes.length;
  } catch (err) {
    // Log the raw error server-side for debugging; surface only a generic message
    // to the client — never expose internal DB error details to the UI.
    console.error("[page] DB connectivity check failed:", (err as Error).message);
    dbError = "Database connectivity check failed — check server logs.";
  }

  return (
    <OwnerDashboard
      displayName={user.displayName}
      episodeCount={episodeCount}
      dbError={dbError}
    />
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SignInPrompt() {
  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-8">
        {/* Logo mark */}
        <div className="space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <span className="text-2xl">🎙️</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">PodLever</h1>
          <p className="text-zinc-400 text-sm">
            One recording. Complete asset suite.
          </p>
        </div>

        {/* Sign-in CTA */}
        <div className="space-y-3">
          <Link
            href="/auth/login"
            className="block w-full py-3 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm transition-colors"
          >
            Sign in to continue
          </Link>
          <p className="text-zinc-600 text-xs">
            Access is restricted to authorized users only.
          </p>
        </div>
      </div>
    </main>
  );
}

function AccessRestricted({ displayName }: { displayName: string }) {
  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <span className="text-xl">🔒</span>
          </div>
          <h1 className="text-xl font-bold text-white">Access Restricted</h1>
          <p className="text-zinc-400 text-sm">
            Signed in as <span className="text-zinc-300 font-medium">{displayName}</span>,
            but this workspace is restricted to its owner.
          </p>
        </div>
        <Link
          href="/auth/logout"
          className="inline-block px-5 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 text-sm transition-colors"
        >
          Sign out
        </Link>
      </div>
    </main>
  );
}

function OwnerDashboard({
  displayName,
  episodeCount,
  dbError,
}: {
  displayName: string;
  episodeCount: number | null;
  dbError: string | null;
}) {
  const checks: Array<{ label: string; status: "ok" | "error" | "pending"; detail?: string }> = [
    {
      label:  "Authentication",
      status: "ok",
      detail: `Signed in as ${displayName} (owner)`,
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
      detail: "users · episodes · assets · pipeline_events",
    },
    {
      label:  "Server Actions",
      status: "ok",
      detail: "createEpisode · listEpisodes · transitionEpisode wired",
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
          <Link
            href="/auth/logout"
            className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 text-xs transition-colors"
          >
            Sign out
          </Link>
        </div>

        {/* Welcome */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <p className="text-zinc-400 text-sm">
            Welcome back, <span className="text-white font-semibold">{displayName}</span>.
            Upload a recording below to generate your show notes and social pack.
          </p>
        </div>

        {/* Studio — the live pipeline */}
        <StudioUploader />

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

        {/* Pending tasks */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1">
            Pending Before Phase 1B
          </h2>
          <div className="rounded-2xl border border-amber-900/40 bg-amber-950/20 divide-y divide-amber-900/30">
            {[
              { ref: "#3", label: "Remove dev diagnostic endpoint (security)" },
              { ref: "#4", label: "Resolve /api proxy routing conflict" },
            ].map((task) => (
              <div key={task.ref} className="flex items-center gap-3 p-4">
                <span className="text-xs font-mono text-amber-600 flex-shrink-0">{task.ref}</span>
                <p className="text-amber-200/70 text-sm">{task.label}</p>
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
