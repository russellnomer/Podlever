/**
 * app/admin/analytics/page.tsx — Owner-only analytics conversion funnel
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #15 — Analytics)
 *
 * Route: /admin/analytics (owner-only, iron-session gated)
 *
 * Server Component. Reads from analytics_events and users tables directly —
 * no third-party scripts, all in-house. Shows the core conversion funnel:
 *
 *   Visitors → Signups → First episode → Upgrade prompt hits → Subscriptions
 *
 * Time window: last 30 days by default; adjustable via ?days= param.
 * Also shows top UTM sources and daily event counts for the selected window.
 *
 * SECURITY: requireOwner() guard — redirects non-owners to /dashboard.
 */

import { redirect }          from "next/navigation";
import Link                  from "next/link";
import { getAuthUser }       from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { db }                from "@/db";
import { analyticsEvents }   from "@/db/schema/analytics-events";
import { users }             from "@/db/schema/users";
import { and, count, gte, eq, desc, sql } from "drizzle-orm";
import { BarChart2, Users, Mic, TrendingUp, ArrowLeft } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getFunnelData(since: Date) {
  // Count events by name in one query
  const eventCounts = await db
    .select({
      eventName: analyticsEvents.eventName,
      total:     count(),
    })
    .from(analyticsEvents)
    .where(gte(analyticsEvents.createdAt, since))
    .groupBy(analyticsEvents.eventName);

  const byName = new Map(eventCounts.map((r) => [r.eventName, r.total]));

  return {
    pageViews:          byName.get("page_view")             ?? 0,
    signups:            byName.get("signup")                ?? 0,
    logins:             byName.get("auth.login")            ?? 0,
    episodesCreated:    byName.get("episode_created")       ?? 0,
    episodesProcessed:  byName.get("episode_processed")     ?? 0,
    upgradePrompts:     byName.get("upgrade_prompt_shown")  ?? 0,
    subscriptions:      byName.get("subscription_started")  ?? 0,
    cancellations:      byName.get("subscription_cancelled") ?? 0,
    invitesClaimed:     byName.get("invite_claimed")        ?? 0,
    onboardings:        byName.get("onboarding_completed")  ?? 0,
  };
}

async function getTopUtmSources(since: Date, limit = 10) {
  return db
    .select({
      source: users.utmSource,
      medium: users.utmMedium,
      count:  count(),
    })
    .from(users)
    .where(and(gte(users.createdAt, since), sql`${users.utmSource} IS NOT NULL`))
    .groupBy(users.utmSource, users.utmMedium)
    .orderBy(desc(count()))
    .limit(limit);
}

async function getDailySignups(since: Date) {
  const rows = await db
    .select({
      day:   sql<string>`DATE(${analyticsEvents.createdAt} AT TIME ZONE 'UTC')`,
      total: count(),
    })
    .from(analyticsEvents)
    .where(
      and(
        gte(analyticsEvents.createdAt, since),
        eq(analyticsEvents.eventName, "signup"),
      ),
    )
    .groupBy(sql`DATE(${analyticsEvents.createdAt} AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(${analyticsEvents.createdAt} AT TIME ZONE 'UTC')`);
  return rows;
}

async function getTotalUsers() {
  const [row] = await db.select({ total: count() }).from(users);
  return row?.total ?? 0;
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, color = "indigo",
}: {
  label: string; value: string | number; sub?: string; color?: "indigo" | "green" | "amber" | "gray";
}) {
  const ring = {
    indigo: "bg-indigo-50 text-indigo-700",
    green:  "bg-green-50 text-green-700",
    amber:  "bg-amber-50 text-amber-700",
    gray:   "bg-gray-100 text-gray-600",
  }[color];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-5">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${ring.split(" ")[1]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  // Auth guard — owner only
  const session = await getAuthUser();
  try {
    await requireOwnerFromSession(session);
  } catch {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const days   = Math.min(90, Math.max(7, parseInt(params.days ?? "30", 10)));
  const since  = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Fetch all data in parallel
  const [funnel, utmSources, dailySignups, totalUsers] = await Promise.all([
    getFunnelData(since),
    getTopUtmSources(since),
    getDailySignups(since),
    getTotalUsers(),
  ]);

  const activationRate = pct(funnel.episodesProcessed, funnel.signups);
  const conversionRate = pct(funnel.subscriptions, funnel.signups);

  const dayOptions = [7, 14, 30, 60, 90];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Link>
            <span className="text-gray-300">/</span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
              <BarChart2 className="w-4 h-4 text-indigo-500" />
              Analytics
            </span>
          </div>
          {/* Time range selector */}
          <div className="flex items-center gap-1">
            {dayOptions.map((d) => (
              <Link
                key={d}
                href={`/admin/analytics?days=${d}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === d
                    ? "bg-indigo-600 text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {d}d
              </Link>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Summary banner */}
        <p className="text-sm text-gray-500">
          Last <strong>{days} days</strong> · <strong>{totalUsers}</strong> total users
        </p>

        {/* Conversion funnel */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Conversion Funnel</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <MetricCard label="Page Views"     value={funnel.pageViews}        color="gray"   />
            <MetricCard label="Signups"         value={funnel.signups}          color="indigo" sub={`${funnel.logins} logins`} />
            <MetricCard label="Invites Claimed" value={funnel.invitesClaimed}   color="indigo" />
            <MetricCard label="Episodes Processed" value={funnel.episodesProcessed} color="green" sub={`Activation: ${activationRate}`} />
            <MetricCard label="Upgrade Prompts" value={funnel.upgradePrompts}   color="amber"  />
            <MetricCard label="Subscriptions"   value={funnel.subscriptions}    color="green"  sub={`Conversion: ${conversionRate}`} />
            <MetricCard label="Cancellations"   value={funnel.cancellations}    color="amber"  />
            <MetricCard label="Onboardings"     value={funnel.onboardings}      color="indigo" />
          </div>
        </section>

        {/* Funnel table */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Funnel Rates</h2>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stage</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Count</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">vs Signups</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  { stage: "Page Views",           n: funnel.pageViews,         showRate: false },
                  { stage: "Signups",               n: funnel.signups,           showRate: false },
                  { stage: "Invites Claimed",       n: funnel.invitesClaimed,    showRate: true },
                  { stage: "First Episode Upload",  n: funnel.episodesCreated,   showRate: true },
                  { stage: "First Episode Processed", n: funnel.episodesProcessed, showRate: true },
                  { stage: "Upgrade Prompt Hit",    n: funnel.upgradePrompts,    showRate: true },
                  { stage: "Subscribed",            n: funnel.subscriptions,     showRate: true },
                ].map(({ stage, n, showRate }) => (
                  <tr key={stage} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-800">{stage}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-700">{n}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-400">
                      {showRate ? pct(n, funnel.signups) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Daily signups sparkline (text-based) */}
        {dailySignups.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Daily Signups</h2>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {dailySignups.map((row) => {
                    const barW = Math.max(4, Math.round((row.total / Math.max(...dailySignups.map((r) => r.total))) * 120));
                    return (
                      <tr key={row.day} className="hover:bg-gray-50">
                        <td className="px-5 py-2.5 text-xs text-gray-400 tabular-nums w-28">{row.day}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="h-3 rounded-sm bg-indigo-500" style={{ width: barW }} />
                            <span className="text-xs font-medium text-gray-700">{row.total}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* UTM sources */}
        {utmSources.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Top Acquisition Sources</h2>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Medium</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Users</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {utmSources.map((row) => (
                    <tr key={`${row.source}-${row.medium}`} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-800">{row.source ?? "—"}</td>
                      <td className="px-5 py-3 text-gray-500">{row.medium ?? "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-700">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Empty state */}
        {funnel.pageViews === 0 && funnel.signups === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
            <BarChart2 className="w-8 h-8 text-gray-300 mb-3" />
            <p className="text-sm text-gray-500 mb-1">No events in the last {days} days</p>
            <p className="text-xs text-gray-400">Events are tracked automatically as users visit and interact with PodLever.</p>
          </div>
        )}
      </main>
    </div>
  );
}
