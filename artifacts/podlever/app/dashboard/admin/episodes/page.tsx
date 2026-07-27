/**
 * app/dashboard/admin/episodes/page.tsx — Owner-only admin view of all episodes
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Tasks #56, #57 — Admin view + usage metering)
 *
 * Route: /dashboard/admin/episodes (owner-only)
 *
 * Server Component. Shows all episodes across all users with:
 *   - Episode title, owner display name, FSM status, creation date
 *   - Per-user usage summary (episodes used vs limit this month)
 *   - Filterable by status via URL search param
 *   - Paginated (25 per page)
 *
 * Security: requireOwner() guard — non-owners receive 403 redirect.
 */

import { redirect }          from "next/navigation";
import Link                  from "next/link";
import { getAuthUser }       from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { episodeRepository } from "@/repositories";
import { usageRepository }   from "@/repositories";
import { CheckCircle2, Clock, Radio, Archive, Users, Mic } from "lucide-react";
import type { Episode } from "@/db/schema";
import { archiveEpisodeFromAdminAction } from "@/app/actions/episode.actions";

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATE_STYLES: Record<string, string> = {
  draft:      "bg-gray-100 text-gray-600",
  processing: "bg-amber-100 text-amber-700",
  ready:      "bg-green-100 text-green-700",
  published:  "bg-indigo-100 text-indigo-700",
  archived:   "bg-gray-100 text-gray-400",
};

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[state] ?? STATE_STYLES.draft}`}>
      {state.charAt(0).toUpperCase() + state.slice(1)}
    </span>
  );
}

// ─── Usage bar ────────────────────────────────────────────────────────────────

function UsageBar({ used, limit }: { used: number; limit: number }) {
  if (limit === Infinity || limit === 0) {
    return <span className="text-xs text-gray-400">{used} / ∞</span>;
  }
  const pct = Math.min((used / limit) * 100, 100);
  const color = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-indigo-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums">{used}/{limit}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminEpisodesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  // Auth guard — owner only
  const session = await getAuthUser();
  try {
    await requireOwnerFromSession(session);
  } catch {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const statusFilter = params.status ?? "";
  const page         = Math.max(1, parseInt(params.page ?? "1", 10));
  const PAGE_SIZE    = 25;

  // Fetch all episodes + per-user usage summary in parallel
  const [allEpisodes, userSummaries] = await Promise.all([
    episodeRepository.listAllEpisodes(500),   // sufficient for beta scale
    usageRepository.listPerUserSummary(),
  ]);

  // Filter by status if requested
  const filtered = statusFilter
    ? allEpisodes.filter((e) => e.state === statusFilter)
    : allEpisodes;

  // Paginate
  const total     = filtered.length;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Index usage summaries by userId for O(1) lookup in the table
  const usageByUser = new Map(userSummaries.map((u) => [u.userId, u]));

  const statusOptions = ["", "draft", "processing", "ready", "published", "archived"];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
              CRM
            </Link>
            <span className="text-gray-300">/</span>
            <Link href="/dashboard/episodes" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
              Episodes
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm font-medium text-gray-800">Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-400">{total} total</span>
            <Link
              href="/admin/users"
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:underline"
            >
              <Users className="w-3.5 h-3.5" />
              Usage by user
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {statusOptions.map((s) => (
            <Link
              key={s || "all"}
              href={`/dashboard/admin/episodes${s ? `?status=${s}` : ""}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-indigo-300"
              }`}
            >
              {s || "All"}
            </Link>
          ))}
        </div>

        {/* Usage summary cards */}
        {userSummaries.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {userSummaries.slice(0, 8).map((u) => (
              <div key={u.userId} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs font-medium text-gray-700 truncate mb-1">{u.displayName ?? "Unknown"}</p>
                <p className="text-xs text-gray-400 mb-2">{u.tierLabel}</p>
                <UsageBar used={u.used} limit={u.limit} />
              </div>
            ))}
          </div>
        )}

        {/* Episodes table */}
        {pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
            <Mic className="w-8 h-8 text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">No episodes match the current filter.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Episode</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Owner</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Usage</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pageItems.map((episode) => {
                  const u = usageByUser.get(episode.ownerId);
                  const created = new Date(episode.createdAt).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  });
                  return (
                    <tr key={episode.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/dashboard/episodes/${episode.id}`}
                          className="font-medium text-gray-900 hover:text-indigo-700 transition-colors line-clamp-1"
                        >
                          {episode.title}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500 text-xs">
                        {u?.displayName ?? episode.ownerId.slice(0, 8) + "…"}
                        <span className="ml-1 text-gray-300">({u?.tierLabel ?? "Free"})</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <StateBadge state={episode.state} />
                      </td>
                      <td className="px-5 py-3.5">
                        {u ? <UsageBar used={u.used} limit={u.limit} /> : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-gray-400">{created}</td>
                      <td className="px-5 py-3.5">
                        {episode.state !== "archived" ? (
                          <form action={archiveEpisodeFromAdminAction}>
                            <input type="hidden" name="episodeId" value={episode.id} />
                            <button
                              type="submit"
                              title="Cancel any jobs and archive this episode (soft delete)"
                              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500
                                         hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
                            >
                              Archive
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  Page {page} of {totalPages} · {total} episodes
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={`/dashboard/admin/episodes?${statusFilter ? `status=${statusFilter}&` : ""}page=${page - 1}`}
                      className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/dashboard/admin/episodes?${statusFilter ? `status=${statusFilter}&` : ""}page=${page + 1}`}
                      className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
