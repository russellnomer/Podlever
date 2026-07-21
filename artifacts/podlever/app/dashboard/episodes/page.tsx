/**
 * app/dashboard/episodes/page.tsx — Episode list dashboard
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #2 — Episode processing pipeline)
 *
 * Route: /dashboard/episodes (owner-only)
 *
 * Server Component. Lists all non-archived episodes for the authenticated owner,
 * newest first. Shows status badges and links to episode detail pages.
 */

import { redirect }              from "next/navigation";
import Link                      from "next/link";
import { getAuthUser }           from "@/providers/auth";
import { requireBetaAccess }     from "@/providers/owner-guard";
import { episodeRepository }     from "@/repositories";
import { Plus, Mic, Clock, CheckCircle2, Radio, Archive } from "lucide-react";
import type { Episode } from "@/db/schema";

// ─── State badge ──────────────────────────────────────────────────────────────

const STATE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  draft:      { label: "Draft",      icon: Clock,         className: "bg-gray-100 text-gray-600" },
  processing: { label: "Processing", icon: Radio,         className: "bg-amber-100 text-amber-700 animate-pulse" },
  ready:      { label: "Ready",      icon: CheckCircle2,  className: "bg-green-100 text-green-700" },
  published:  { label: "Published",  icon: Radio,         className: "bg-indigo-100 text-indigo-700" },
  archived:   { label: "Archived",   icon: Archive,       className: "bg-gray-100 text-gray-400" },
};

function StateBadge({ state }: { state: string }) {
  const cfg  = STATE_CONFIG[state] ?? STATE_CONFIG.draft!;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Episode card ─────────────────────────────────────────────────────────────

function EpisodeCard({ episode }: { episode: Episode }) {
  const created = new Date(episode.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <Link
      href={`/dashboard/episodes/${episode.id}`}
      className="group flex items-center justify-between gap-4 rounded-xl border border-gray-200
                 bg-white px-5 py-4 shadow-sm transition-all hover:border-indigo-300 hover:shadow-md"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
          <Mic className="w-5 h-5 text-indigo-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
            {episode.title}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{created}</p>
        </div>
      </div>
      <StateBadge state={episode.state} />
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EpisodesPage() {
  // Auth guard — allows owners AND active beta users
  const session = await getAuthUser();
  let ownerId: string;
  let isOwner = false;
  try {
    const identity = await requireBetaAccess(session);
    ownerId  = identity.userId;
    isOwner  = identity.isOwner;
  } catch {
    redirect("/auth/login");
  }

  const episodes = await episodeRepository.listEpisodesForOwner(ownerId);
  const processingCount = episodes.filter((e) => e.state === "processing").length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900">Episodes</h1>
            {processingCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                <Radio className="w-3 h-3 animate-pulse" />
                {processingCount} processing
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* CRM link visible to owner only — beta users have no CRM access */}
            {isOwner && (
              <Link
                href="/dashboard"
                className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
              >
                CRM
              </Link>
            )}
            <Link
              href="/dashboard/episodes/new"
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New episode
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {episodes.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-white py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
              <Mic className="w-7 h-7 text-indigo-500" />
            </div>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">No episodes yet</h2>
            <p className="text-sm text-gray-500 mb-6 max-w-xs">
              Upload your first episode and PodLever will generate a full content suite in minutes.
            </p>
            <Link
              href="/dashboard/episodes/new"
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Upload your first episode
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {episodes.map((episode) => (
              <EpisodeCard key={episode.id} episode={episode} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
