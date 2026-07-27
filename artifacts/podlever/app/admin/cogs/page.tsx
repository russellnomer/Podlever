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
import { ArrowLeft, DollarSign, TrendingUp, Zap, AlertCircle, Building2, Trash2 } from "lucide-react";
import { businessCosts }     from "@/db/schema/business-costs";
import { users }             from "@/db/schema/users";
import { getTier }           from "@/lib/tiers";
import { addBusinessCostAction, removeBusinessCostAction } from "@/app/actions/business-costs.actions";

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

/** Active fixed costs, newest first. */
async function getFixedCosts() {
  return db
    .select()
    .from(businessCosts)
    .where(eq(businessCosts.active, true))
    .orderBy(desc(businessCosts.createdAt));
}

/**
 * Estimated MRR from current paid plans (pro/agency, annual-rate equivalent)
 * plus estimated Stripe fees (2.9% + $0.30 per paying subscription/month).
 * Refined once Stripe billing-period data flows through webhooks.
 */
async function getRevenueEstimate() {
  const rows = await db
    .select({ plan: users.plan, cnt: sql<string>`COUNT(*)::int` })
    .from(users)
    .where(sql`${users.plan} IN ('pro', 'agency')`)
    .groupBy(users.plan);

  let mrr = 0;
  let payingSubs = 0;
  for (const r of rows) {
    const n = Number(r.cnt);
    payingSubs += n;
    mrr += n * getTier(r.plan).pricePerMonthAnnual;
  }
  const stripeFees = mrr * 0.029 + payingSubs * 0.30;
  return { mrr, payingSubs, stripeFees };
}

export default async function CogsPage() {
  const session = await getAuthUser();
  try {
    await requireOwnerFromSession(session);
  } catch {
    redirect("/auth/login");
  }

  const [summary, byStep, topEps, jobCounts, fixedCosts, revenue] = await Promise.all([
    getMonthlySummary(),
    getByStep(),
    getTopEpisodes(),
    getJobCounts().catch((): Record<string, number> => ({})),
    getFixedCosts(),
    getRevenueEstimate(),
  ]);

  const fixedBurn = fixedCosts.reduce((t, c) => t + parseFloat(c.monthlyUsd), 0);
  const netMargin = revenue.mrr - revenue.stripeFees - summary.thisMonthUsd - fixedBurn;

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

        {/* Fixed monthly costs + true margin (founder request 2026-07-27) */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">Fixed Monthly Costs &amp; True Margin</h2>
          </div>

          {/* Margin snapshot */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">Est. MRR ({revenue.payingSubs} paid)</p>
              <p className="text-lg font-bold text-gray-900">${revenue.mrr.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">Est. Stripe fees</p>
              <p className="text-lg font-bold text-gray-900">-${revenue.stripeFees.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">AI COGS + fixed burn</p>
              <p className="text-lg font-bold text-gray-900">-${(summary.thisMonthUsd + fixedBurn).toFixed(2)}</p>
            </div>
            <div className={`rounded-xl border p-4 ${netMargin >= 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <p className="text-xs text-gray-500">Net this month</p>
              <p className={`text-lg font-bold ${netMargin >= 0 ? "text-green-700" : "text-red-700"}`}>
                {netMargin < 0 ? "-" : ""}${Math.abs(netMargin).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Cost rows */}
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            {fixedCosts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-400">
                No fixed costs yet — add Replit, GoDaddy, Google Workspace, Viktor, etc. below
                (for annual bills enter the amount &divide; 12).
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {fixedCosts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-5 py-3 font-medium text-gray-900">{c.label}</td>
                      <td className="px-5 py-3 text-xs text-gray-500">{c.category}</td>
                      <td className="px-5 py-3 text-xs text-gray-400">{c.notes}</td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-900">
                        ${parseFloat(c.monthlyUsd).toFixed(2)}/mo
                      </td>
                      <td className="px-3 py-3">
                        <form action={removeBusinessCostAction}>
                          <input type="hidden" name="costId" value={c.id} />
                          <button type="submit" title="Remove" className="text-gray-300 hover:text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td className="px-5 py-3 font-semibold text-gray-700" colSpan={3}>Total fixed burn</td>
                    <td className="px-5 py-3 text-right font-bold text-gray-900">${fixedBurn.toFixed(2)}/mo</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Add form */}
          <form action={addBusinessCostAction} className="mt-3 flex flex-wrap items-center gap-2">
            <input name="label" required placeholder="Label (e.g. Replit Core + Autoscale)"
                   className="min-w-56 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <select name="category" className="rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-700">
              <option value="infrastructure">Infrastructure</option>
              <option value="software">Software</option>
              <option value="services">Services</option>
              <option value="other">Other</option>
            </select>
            <input name="monthlyUsd" required type="number" step="0.01" min="0" placeholder="$/month"
                   className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input name="notes" placeholder="Notes (optional)"
                   className="min-w-40 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <button type="submit"
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Add cost
            </button>
          </form>
        </section>

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
