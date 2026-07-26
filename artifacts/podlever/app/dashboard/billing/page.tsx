/**
 * app/dashboard/billing/page.tsx — Billing & subscription management
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Route: /dashboard/billing (authenticated users)
 *
 * Server Component. Reads billing state directly from the DB (users table).
 * Shows current plan, renewal date, upgrade CTAs, and Manage Subscription link.
 */

import { redirect }          from "next/navigation";
import Link                  from "next/link";
import { getAuthUser }       from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { db }                from "@/db";
import { users }             from "@/db/schema";
import { eq }                from "drizzle-orm";
import { getTier }           from "@/lib/tiers";
import { ArrowLeft, CreditCard, CheckCircle2, AlertTriangle, Zap } from "lucide-react";

// ─── Upgrade card ─────────────────────────────────────────────────────────────

function UpgradeCard({
  name, priceMonthly, priceAnnual, features, href,
}: {
  name: string; priceMonthly: number; priceAnnual: number;
  features: string[]; href: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 flex flex-col gap-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500 mb-1">{name}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-gray-900">${priceAnnual}</span>
          <span className="text-sm text-gray-400">/mo, billed annually</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">${priceMonthly}/mo billed monthly</p>
      </div>
      <ul className="space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <a
        href={href}
        className="mt-auto flex items-center justify-center gap-2 w-full rounded-xl bg-indigo-600
                   px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
      >
        <Zap className="w-4 h-4" />
        Upgrade to {name}
      </a>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await getAuthUser();
  let userId: string;
  try {
    const identity = await requireOwnerFromSession(session);
    userId = identity.userId;
  } catch {
    redirect("/auth/login");
  }

  const params  = await searchParams;
  const success = params.success === "1";
  const hasErr  = !!params.error;

  // ── Fetch billing state from DB ───────────────────────────────────────────
  const [user] = await db
    .select({
      plan:              users.plan,
      stripeCustomerId:  users.stripeCustomerId,
      planPeriodEnd:     users.planPeriodEnd,
      paymentGraceUntil: users.paymentGraceUntil,
    })
    .from(users)
    .where(eq(users.id, userId!));

  const plan    = user?.plan ?? "free";
  const tier    = getTier(plan);
  const isPaid  = plan === "pro" || plan === "agency";
  const inGrace = user?.paymentGraceUntil ? user.paymentGraceUntil > new Date() : false;

  const periodEnd = user?.planPeriodEnd
    ? new Date(user.planPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  const graceEnd = user?.paymentGraceUntil
    ? new Date(user.paymentGraceUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center gap-3">
          <Link href="/dashboard/episodes" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Episodes
          </Link>
          <span className="text-gray-300">/</span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
            <CreditCard className="w-4 h-4 text-indigo-500" />
            Billing
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Success banner */}
        {success && (
          <div className="flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 px-5 py-4">
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
            <p className="text-sm font-medium text-green-800">Subscription activated — your plan has been upgraded.</p>
          </div>
        )}

        {/* Portal error */}
        {hasErr && (
          <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 px-5 py-4">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">Couldn&apos;t open the billing portal. Try again or contact support.</p>
          </div>
        )}

        {/* Payment grace warning */}
        {inGrace && graceEnd && (
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-5 py-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Payment issue</p>
              <p className="text-sm text-amber-700 mt-0.5">
                Your last payment failed. Access continues until {graceEnd}. Update your payment method to avoid interruption.
              </p>
            </div>
          </div>
        )}

        {/* Current plan card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Current plan</p>
              <p className="text-2xl font-bold text-gray-900">{tier.label}</p>
              {tier.pricePerMonthAnnual > 0 && (
                <p className="text-sm text-gray-500 mt-1">${tier.pricePerMonthAnnual}/mo · billed annually</p>
              )}
              {periodEnd && <p className="text-xs text-gray-400 mt-1">Renews {periodEnd}</p>}
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isPaid ? "bg-indigo-100 text-indigo-700" :
              plan === "beta" ? "bg-purple-100 text-purple-700" :
              "bg-gray-100 text-gray-500"
            }`}>
              {plan === "beta" ? "Beta Access" : tier.label}
            </span>
          </div>

          {/* Episode limit */}
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-sm text-gray-600">
              {tier.isTrialOnly ? (
                // One-time trial — not a recurring monthly allowance
                <>
                  <span className="font-medium">1 episode</span> (one-time trial)
                </>
              ) : (
                <>
                  <span className="font-medium">{tier.episodesPerMonth}</span>{" "}
                  {tier.episodesPerMonth === 1 ? "episode" : "episodes"}/month included
                </>
              )}
            </p>
          </div>

          {/* Manage button for paid users */}
          {isPaid && user?.stripeCustomerId && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <a
                href="/api/billing/portal-redirect"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5
                           text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <CreditCard className="w-4 h-4" />
                Manage subscription
              </a>
              <p className="text-xs text-gray-400 mt-2">
                Opens Stripe — view invoices, change plan, or cancel.
              </p>
            </div>
          )}
        </div>

        {/* Upgrade cards for free / beta users */}
        {!isPaid && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Upgrade your plan</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <UpgradeCard
                name="Pro"
                priceMonthly={41}
                priceAnnual={29}
                href="/pricing?upgrade=pro"
                features={["10 episodes/month", "All asset types", "Priority processing", "Email support"]}
              />
              <UpgradeCard
                name="Agency"
                priceMonthly={199}
                priceAnnual={149}
                href="/pricing?upgrade=agency"
                features={["50 episodes/month", "White-label exports", "5 team seats", "API access", "Priority SLA"]}
              />
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center">
              Receipts sent automatically · Cancel anytime via Stripe portal
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
