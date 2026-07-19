/**
 * app/pricing/page.tsx — PodLever pricing page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — Landing page + pricing)
 *
 * Server Component. Renders the full pricing page with:
 *   - 3-tier pricing cards (Free / Pro / Agency)
 *   - Annual/monthly toggle (client interaction via URL param)
 *   - Feature comparison table
 *   - Waitlist capture for paid tiers (Stripe not yet wired)
 *   - CTA to auth flow for free tier
 *
 * Pricing (annual rates shown; monthly is 1.4×):
 *   Free    → $0/mo      (1 episode/month, core assets only)
 *   Pro     → $29/mo     (10 episodes/month, all assets, priority processing)
 *   Agency  → $97/mo     (unlimited, white-label, team seats)
 *
 * HUMAN REVIEW NOTES:
 * - CTA buttons on paid tiers link to the waitlist form (Stripe not wired yet).
 * - Free tier CTA links to /auth/login to start the auth flow.
 * - Annual/monthly toggle is a PricingToggle Client Component (interactive).
 * - The pricing page is intentionally standalone — no auth check needed.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PricingToggle } from "@/app/components/PricingToggle";
import { WaitlistForm } from "@/app/components/WaitlistForm";

// ─── Page metadata ────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Pricing — PodLever Podcast Content Engine",
  description:
    "Start free. Upgrade when you need more. PodLever turns raw episodes into transcripts, show notes, blog posts, and social clips — from $0/month.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing — PodLever",
    description:
      "Free, Pro ($29/mo), and Agency ($97/mo) plans. One recording. A complete content library.",
    url: "/pricing",
  },
};

// ─── Pricing data ──────────────────────────────────────────────────────────────

const MONTHLY_PRICES = {
  free:   0,
  pro:    41,   // Monthly rate when billed monthly
  agency: 136,  // Monthly rate when billed monthly
} as const;

const ANNUAL_PRICES = {
  free:   0,
  pro:    29,   // Monthly rate when billed annually ($348/yr)
  agency: 97,   // Monthly rate when billed annually ($1,164/yr)
} as const;

type Tier = "free" | "pro" | "agency";

const FEATURES: Array<{
  category: string;
  items: Array<{ label: string; free: string | boolean; pro: string | boolean; agency: string | boolean }>;
}> = [
  {
    category: "Processing",
    items: [
      { label: "Episodes per month",      free: "1",         pro: "10",       agency: "Unlimited" },
      { label: "Max file duration",       free: "60 min",    pro: "4 hours",  agency: "4 hours" },
      { label: "Processing priority",     free: "Standard",  pro: "Priority", agency: "Priority" },
    ],
  },
  {
    category: "Assets generated",
    items: [
      { label: "Cleaned audio",           free: true,  pro: true,  agency: true  },
      { label: "Full transcript",         free: true,  pro: true,  agency: true  },
      { label: "Show notes",              free: true,  pro: true,  agency: true  },
      { label: "Blog post",               free: false, pro: true,  agency: true  },
      { label: "Social posts",            free: false, pro: true,  agency: true  },
      { label: "YouTube cut",             free: false, pro: true,  agency: true  },
      { label: "Vertical clip (Shorts)",  free: false, pro: true,  agency: true  },
      { label: "Guest media pack",        free: false, pro: true,  agency: true  },
    ],
  },
  {
    category: "Platform",
    items: [
      { label: "Asset download",          free: true,   pro: true,           agency: true          },
      { label: "Revision requests",       free: "1/ep", pro: "3/ep",         agency: "Unlimited"   },
      { label: "Team seats",              free: "1",    pro: "1",            agency: "5"           },
      { label: "White-label exports",     free: false,  pro: false,          agency: true          },
      { label: "API access",              free: false,  pro: false,          agency: true          },
    ],
  },
  {
    category: "Support",
    items: [
      { label: "Support channel",         free: "Community", pro: "Email",   agency: "Priority email" },
      { label: "SLA",                     free: false,       pro: false,     agency: "24h response"   },
    ],
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * PricingPage — Pricing tiers and feature comparison (Server Component).
 *
 * Reads `billing` search param (annual | monthly) to set initial toggle state.
 * The PricingToggle client component handles the interactive switch.
 */
export default function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  // We don't need to await searchParams since PricingToggle is a client component
  // that reads window.location to handle the toggle state.
  void searchParams;

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-zinc-100">

      {/* Nav */}
      <nav
        className="sticky top-0 z-50 border-b border-zinc-800/60 bg-[#0D0D0F]/90 backdrop-blur-md"
        aria-label="Pricing page navigation"
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group" aria-label="PodLever home">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
              <WaveformIcon />
            </div>
            <span className="font-bold text-white tracking-tight">PodLever</span>
          </Link>
          <Link
            href="/auth/login"
            className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 text-sm font-semibold transition-colors"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Header */}
      <section className="relative overflow-hidden pt-20 pb-16 px-6 text-center" aria-labelledby="pricing-heading">
        {/* Ambient glow */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex justify-center">
          <div className="w-[500px] h-[300px] rounded-full bg-amber-500/6 blur-[100px] mt-8" />
        </div>
        <div className="relative max-w-3xl mx-auto space-y-5">
          <p className="text-amber-400 text-sm font-semibold uppercase tracking-wider">Pricing</p>
          <h1
            id="pricing-heading"
            className="text-5xl sm:text-6xl font-bold tracking-tight text-white leading-tight"
          >
            Start free.{" "}
            <span className="text-amber-400">Scale</span> when you&apos;re ready.
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed max-w-xl mx-auto">
            A free tier that delivers real value, Pro for serious podcasters,
            and Agency for production teams. No hidden fees.
          </p>
        </div>
      </section>

      {/* Billing toggle + cards */}
      <section className="px-6 pb-20" aria-label="Pricing plans">
        <div className="max-w-6xl mx-auto space-y-10">
          {/* Toggle */}
          <div className="flex justify-center">
            <PricingToggle />
          </div>

          {/* Tier cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <TierCard
              tier="free"
              name="Free"
              tagline="Try PodLever risk-free"
              annualPrice={ANNUAL_PRICES.free}
              monthlyPrice={MONTHLY_PRICES.free}
              highlight={false}
              ctaLabel="Start for free"
              ctaHref="/auth/login"
              ctaVariant="outline"
              badge={null}
              perks={[
                "1 episode per month",
                "Transcript + show notes",
                "Cleaned audio export",
                "60-minute max file duration",
                "Community support",
              ]}
            />
            <TierCard
              tier="pro"
              name="Pro"
              tagline="For serious podcasters"
              annualPrice={ANNUAL_PRICES.pro}
              monthlyPrice={MONTHLY_PRICES.pro}
              highlight={true}
              ctaLabel="Join Pro Waitlist"
              ctaHref={null}
              ctaVariant="primary"
              badge="Most popular"
              perks={[
                "10 episodes per month",
                "All 8 output assets",
                "Priority processing queue",
                "4-hour max file duration",
                "3 revision requests per episode",
                "Email support",
              ]}
            />
            <TierCard
              tier="agency"
              name="Agency"
              tagline="For production teams"
              annualPrice={ANNUAL_PRICES.agency}
              monthlyPrice={MONTHLY_PRICES.agency}
              highlight={false}
              ctaLabel="Join Agency Waitlist"
              ctaHref={null}
              ctaVariant="outline"
              badge={null}
              perks={[
                "Unlimited episodes",
                "All 8 output assets",
                "Priority processing",
                "5 team seats",
                "Unlimited revisions",
                "White-label exports",
                "API access",
                "Priority email support (24h SLA)",
              ]}
            />
          </div>

          {/* Annual savings note */}
          <p className="text-center text-zinc-500 text-sm">
            Annual billing saves up to{" "}
            <span className="text-amber-400 font-medium">29%</span> vs. monthly.
            Cancel anytime.
          </p>
        </div>
      </section>

      {/* Feature comparison table */}
      <section className="py-20 px-6 border-t border-zinc-800/40" aria-labelledby="comparison-heading">
        <div className="max-w-5xl mx-auto">
          <h2
            id="comparison-heading"
            className="text-3xl font-bold tracking-tight text-white text-center mb-12"
          >
            Full feature comparison
          </h2>

          <div className="overflow-x-auto rounded-2xl border border-zinc-800/60">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="bg-zinc-900/60">
                  <th className="text-left px-6 py-4 text-zinc-400 font-medium w-1/2" scope="col">
                    Feature
                  </th>
                  <th className="text-center px-4 py-4 text-zinc-400 font-medium" scope="col">Free</th>
                  <th className="text-center px-4 py-4 text-amber-400 font-semibold" scope="col">
                    Pro
                  </th>
                  <th className="text-center px-4 py-4 text-zinc-400 font-medium" scope="col">Agency</th>
                </tr>
              </thead>
              {FEATURES.map((group) => (
                  <tbody key={group.category} className="divide-y divide-zinc-800/40">
                    {/* Category header */}
                    <tr className="bg-zinc-900/30">
                      <td
                        colSpan={4}
                        className="px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider"
                      >
                        {group.category}
                      </td>
                    </tr>
                    {/* Feature rows */}
                    {group.items.map((item) => (
                      <tr
                        key={item.label}
                        className="hover:bg-zinc-900/30 transition-colors"
                      >
                        <td className="px-6 py-3.5 text-zinc-300">{item.label}</td>
                        <td className="px-4 py-3.5 text-center">
                          <FeatureCell value={item.free} />
                        </td>
                        <td className="px-4 py-3.5 text-center bg-amber-500/3">
                          <FeatureCell value={item.pro} isHighlight />
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <FeatureCell value={item.agency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
            </table>
          </div>
        </div>
      </section>

      {/* FAQ teaser */}
      <section className="py-20 px-6 border-t border-zinc-800/40" aria-labelledby="faq-heading">
        <div className="max-w-3xl mx-auto space-y-8">
          <h2
            id="faq-heading"
            className="text-3xl font-bold tracking-tight text-white text-center"
          >
            Common questions
          </h2>
          <div className="space-y-4">
            {[
              {
                q: "When does the free tier expire?",
                a: "It doesn't. The free tier is permanently free — 1 episode per month, every month. No trial period, no credit card required.",
              },
              {
                q: "What happens when I hit my episode limit?",
                a: "You'll see a clear message in your dashboard. You can upgrade at any time or wait for the next month's allowance to reset.",
              },
              {
                q: "Are Stripe payments live yet?",
                a: "Pro and Agency tiers are in early access. Join the waitlist and we'll notify you when billing is live — with a launch discount for waitlist members.",
              },
              {
                q: "What audio/video formats do you support?",
                a: "MP3, MP4, WAV, M4A, and MOV. Files up to 4 hours in length (1 hour on Free). More formats coming based on user demand.",
              },
            ].map((faq) => (
              <div
                key={faq.q}
                className="p-5 rounded-xl border border-zinc-800/60 bg-zinc-900/30 space-y-2"
              >
                <p className="text-white font-medium text-sm">{faq.q}</p>
                <p className="text-zinc-400 text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 px-6 border-t border-zinc-800/40 bg-zinc-900/20" aria-labelledby="bottom-cta-heading">
        <div className="max-w-xl mx-auto text-center space-y-6">
          <h2
            id="bottom-cta-heading"
            className="text-3xl font-bold tracking-tight text-white"
          >
            Ready to reclaim your week?
          </h2>
          <p className="text-zinc-400 leading-relaxed">
            Start free today. No credit card, no commitment.
            Join the waitlist to be first in line for Pro and Agency access.
          </p>
          <div className="flex flex-col items-center gap-4">
            <Link
              href="/auth/login"
              className="w-full max-w-xs px-8 py-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-base transition-colors text-center"
            >
              Start free — no card needed
            </Link>
            <WaitlistForm
              source="pricing_bottom"
              variant="default"
              placeholder="Email for Pro/Agency waitlist"
              buttonLabel="Join Waitlist"
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/60 py-8 px-6" aria-label="Pricing page footer">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">
            ← Back to PodLever
          </Link>
          <div className="flex items-center gap-6">
            {/* Legal links — required before collecting email addresses publicly */}
            <Link href="/privacy" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">
              Terms of Service
            </Link>
            <p className="text-zinc-600 text-xs">
              © {new Date().getFullYear()} Russell Nomer Consulting.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

interface TierCardProps {
  tier: Tier;
  name: string;
  tagline: string;
  annualPrice: number;
  monthlyPrice: number;
  highlight: boolean;
  ctaLabel: string;
  ctaHref: string | null;   // null = show waitlist form instead
  ctaVariant: "primary" | "outline";
  badge: string | null;
  perks: string[];
}

function TierCard({
  tier,
  name,
  tagline,
  annualPrice,
  monthlyPrice,
  highlight,
  ctaLabel,
  ctaHref,
  ctaVariant,
  badge,
  perks,
}: TierCardProps) {
  return (
    <div
      className={[
        "relative flex flex-col rounded-2xl border p-6 transition-all",
        highlight
          ? "bg-amber-500/5 border-amber-500/30 shadow-[0_0_60px_rgba(245,158,11,0.06)]"
          : "bg-zinc-900/30 border-zinc-800/60",
      ].join(" ")}
    >
      {/* Popular badge */}
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 rounded-full bg-amber-400 text-zinc-950 text-xs font-bold">
            {badge}
          </span>
        </div>
      )}

      <div className="flex-1 space-y-5">
        {/* Tier name + tagline */}
        <div>
          <h3
            className={[
              "text-xl font-bold",
              highlight ? "text-amber-400" : "text-white",
            ].join(" ")}
          >
            {name}
          </h3>
          <p className="text-zinc-500 text-sm mt-0.5">{tagline}</p>
        </div>

        {/* Price display — client toggle shows annual or monthly */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-bold text-white" data-tier={tier} data-annual={annualPrice} data-monthly={monthlyPrice}>
              ${annualPrice}
            </span>
            <span className="text-zinc-500 text-sm">/mo</span>
          </div>
          {annualPrice > 0 && (
            <p className="text-zinc-600 text-xs" data-billing-note={tier}>
              billed annually · ${monthlyPrice}/mo billed monthly
            </p>
          )}
        </div>

        {/* Divider */}
        <div className={["h-px", highlight ? "bg-amber-500/20" : "bg-zinc-800"].join(" ")} aria-hidden="true" />

        {/* Perks list */}
        <ul className="space-y-2.5" aria-label={`${name} plan features`}>
          {perks.map((perk) => (
            <li key={perk} className="flex items-start gap-2.5 text-sm text-zinc-300">
              <svg
                className={["flex-shrink-0 mt-0.5 w-4 h-4", highlight ? "text-amber-400" : "text-zinc-500"].join(" ")}
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                  clipRule="evenodd"
                />
              </svg>
              {perk}
            </li>
          ))}
        </ul>
      </div>

      {/* CTA */}
      <div className="mt-6 space-y-3">
        {ctaHref ? (
          <Link
            href={ctaHref}
            className={[
              "block w-full py-3 px-5 rounded-xl text-sm font-semibold text-center transition-colors",
              ctaVariant === "primary"
                ? "bg-amber-400 hover:bg-amber-300 text-zinc-950"
                : "border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white",
            ].join(" ")}
          >
            {ctaLabel}
          </Link>
        ) : (
          <WaitlistForm
            source={`pricing_${tier}`}
            variant="default"
            placeholder="your@email.com"
            buttonLabel={ctaLabel}
          />
        )}
      </div>
    </div>
  );
}

/** Renders a feature cell value: boolean → checkmark/dash, string → text. */
function FeatureCell({
  value,
  isHighlight = false,
}: {
  value: string | boolean;
  isHighlight?: boolean;
}) {
  if (value === true) {
    return (
      <span
        className={isHighlight ? "text-amber-400" : "text-zinc-400"}
        aria-label="Included"
      >
        <svg className="w-5 h-5 mx-auto" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="text-zinc-700" aria-label="Not included">
        <svg className="w-5 h-5 mx-auto" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </span>
    );
  }
  return (
    <span className={isHighlight ? "text-amber-300 font-medium" : "text-zinc-400"}>
      {value}
    </span>
  );
}

/** Waveform icon — PodLever logo mark. */
function WaveformIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-amber-400">
      <rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" />
      <rect x="4.5" y="3" width="2" height="10" rx="1" fill="currentColor" />
      <rect x="8" y="1" width="2" height="14" rx="1" fill="currentColor" />
      <rect x="11.5" y="4" width="2" height="8" rx="1" fill="currentColor" />
      <rect x="15" y="6" width="1" height="4" rx="0.5" fill="currentColor" />
    </svg>
  );
}
