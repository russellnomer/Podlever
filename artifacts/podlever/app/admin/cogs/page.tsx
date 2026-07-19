/**
 * app/admin/cogs/page.tsx — COGS (Cost of Goods Sold) admin dashboard
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Week-1 cost audit)
 *
 * Route: /admin/cogs (owner-only, Server Component)
 *
 * Shows:
 *   - Total AI cost this month vs prior month
 *   - Average cost per episode
 *   - Cost breakdown by step (transcription, generation, cleanup, PDF)
 *   - Top 10 most expensive episodes
 *   - Job queue health (pending / running / failed counts)
 *
 * Used for: GM floor monitoring, pricing validation, model optimization.
 *
 * SECURITY: admin route — same requireOwner() guard as all admin pages.
 *           No PII displayed — only aggregate stats and episode IDs.
 */

import { redirect }          from "next/navigation";
import Link                  from "next/link";
import { getAuthUser }       from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { db }                from "@/db";
import { episodeCogs }       from "@/db/schema/episode-cogs";
import { episodes }          from "@/db/schema";
import { eq, sql, desc, gte, and } from "drizzle-orm";
import { getJobCounts }      from "@/lib/job-queue";
import { ArrowLeft, DollarSign, TrendingUp, Zap, AlertCircle } from "lucide-react";

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function getMonthlySummary() {
  const now        = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLast  = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [thisMonth, lastMonth] = await Promise.all([
    db.execute<{ total: string; count: string }>(sql`
      SELECT
        COALESCE(SUM(cost_usd), 0)::text  AS total,
        COUNT(DISTINCT episode_id)::text   AS count
      FROM episode_cogs
      WHERE created_at >= ${firstOfMonth.toISOString()}
    `),
    db.execute<{ total: string; count: string }>(sql`
      SELECT
        COALESCE(SUM(cost_usd), 0)::text  AS total,
        COUNT(DISTINCT episode_id)::text   AS count
      FROM episode_cogs
      WHERE created_at >= ${firstOfLast.toISOString()}
        AND created_at <  ${firstOfMonth.toISOString()}
    `),
  ]);

  const thisTotal = parseFloat(thisMonth.rows[0]?.total ?? "0");
  const lastTotal = parseFloat(lastMonth.rows[0]?.total ?? "0");
  const thisEps   = parseInt(thisMonth.rows[0]?.count ?? "0", 10);

  return {
    thisMonthUsd:  thisTotal,
    lastMonthUsd:  lastTotal,
    episodesCount: thisEps,
    avgPerEpisode: thisEps > 0 ? thisTotal / thisEps : 0,
    monthLabel:    now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  };
}

async function getByStep() {
  const rows = await db.execute<{ step: string; total: string; calls: string }>(sql`
    SELECT
      step,
      SUM(cost_usd)::text    AS total,
      COUNT(*)::text         AS calls
    FROM episode_cogs
    GROUP BY step
    ORDER BY SUM(cost_usd) DESC
  `);
  return rows.rows.map((r) => ({
    step:     r.step,
    totalUsd: parseFloat(r.total),
    calls:    parseInt(r.calls, 10),
  }));
}

async function getTopEpisodes() {
  const rows = await db.execute<{ episode_id: string; title: string; total: string; processed_at: string }>(sql`
    SELECT
      c.episode_id,
      e.title,
      SUM(c.cost_usd)::text  AS total,
      MAX(c.created_at)::text AS processed_at
    FROM episode_cogs c
    JOIN episodes e ON e.id = c.episode_id
    GROUP BY c.episode_id, e.title
    ORDER BY SUM(c.cost_usd) DESC
    LIMIT 10
  `);
  return rows.rows.map((r) => ({
    episodeId:   r.episode_id,
    title:       r.title,
    totalUsd:    parseFloat(r.total),
    processedAt: new Date(r.processed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, highlight }: {
  label:     string;
  value:     string;
  sub?:      string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-5 py-4 ${highlight ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? "text-amber-700" : "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CogsPage() {
  const session = await getAuthUser();
  try {
    await requireOwnerFromSession(session);
  } catch {
    redirect("/auth/login");
  }

  const [summary, byStep, topEps, jobCounts] = await Promise.all([
    getMonthlySummary(),
    getByStep(),
    getTopEpisodes(),
    getJobCounts().catch((): Record<string, number> => ({})),
  ]);

  const failedJobs  = (jobCounts["failed"] ?? 0);
  const runningJobs = (jobCounts["running"] ?? 0);
  const pendingJobs = (jobCounts["pending"] ?? 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center gap-4">
          <Link
            href="/admin"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Admin
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-semibold text-gray-800">COGS Dashboard</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">AI Cost of Goods Sold</h1>
          <span className="text-sm text-gray-400">{summary.monthLabel}</span>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="This month"
            value={`$${summary.thisMonthUsd.toFixed(4)}`}
            sub={`${summary.episodesCount} episodes`}
          />
          <StatCard
            label="Last month"
            value={`$${summary.lastMonthUsd.toFixed(4)}`}
          />
          <StatCard
            label="Avg per episode"
            value={`$${summary.avgPerEpisode.toFixed(4)}`}
            sub="this month"
            highlight={summary.avgPerEpisode > 0.10}
          />
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">Job queue</p>
            <div className="space-y-1">
              <p className="text-xs text-gray-700">Pending: <strong>{pendingJobs}</strong></p>
              <p className="text-xs text-gray-700">Running: <strong>{runningJobs}</strong></p>
              <p className={`text-xs font-semibold ${failedJobs > 0 ? "text-red-600" : "text-green-600"}`}>
                {failedJobs > 0 ? `⚠ Failed: ${failedJobs}` : "✓ No failures"}
              </p>
            </div>
          </div>
        </div>

        {/* Failed jobs alert */}
        {failedJobs > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">{failedJobs} job(s) failed permanently</p>
              <p className="text-xs text-red-600 mt-0.5">
                These exceeded max retry attempts. Check the <code className="font-mono">job_queue</code> table for
                <code className="font-mono mx-1">last_error</code> details.
              </p>
            </div>
          </div>
        )}

        {/* Cost by step */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Cost by Pipeline Step</h2>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Step</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total cost</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Calls</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg/call</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byStep.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-400">
                      No cost data yet — process an episode to see COGS.
                    </td>
                  </tr>
                ) : byStep.map((row) => (
                  <tr key={row.step} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-gray-700">{row.step}</td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-900">${row.totalUsd.toFixed(5)}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{row.calls.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-gray-500 text-xs">
                      ${(row.totalUsd / row.calls).toFixed(5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Top episodes by cost */}
        {topEps.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Most Expensive Episodes</h2>
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Episode</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">AI cost</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Processed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topEps.map((ep) => (
                    <tr key={ep.episodeId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <Link
                          href={`/dashboard/episodes/${ep.episodeId}`}
                          className="text-indigo-600 hover:underline text-sm font-medium"
                        >
                          {ep.title || ep.episodeId}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-900">${ep.totalUsd.toFixed(5)}</td>
                      <td className="px-5 py-3 text-right text-gray-500 text-xs">{ep.processedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Margin note */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
          <p className="text-xs text-indigo-700">
            <strong>Target:</strong> COGS per episode &lt; $0.05 for Pro plan ($19/mo, 10 episodes = $1.90 revenue each).
            Average above $0.10/episode = margin alert. Update <code className="font-mono">lib/cogs.ts</code> pricing
            constants when Replit AI credit rates change.
          </p>
        </div>
      </main>
    </div>
  );
}
