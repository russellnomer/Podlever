/**
 * app/pricing/page.tsx — PodLever pricing page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #58 — Wire pricing page to Stripe Checkout)
 *
 * Async Server Component. On each request:
 *   1. Reads the `?upgrade=` search param — if present and the user is
 *      logged in, redirects immediately to /rpc/billing/upgrade so the
 *      billing dashboard "Upgrade" links never touch client JS.
 *   2. Fetches live Stripe price IDs by querying products filtered on
 *      metadata.plan_slug — no hardcoded price IDs.
 *   3. Renders Founding Member pricing with CheckoutButton replacing
 *      WaitlistForm on Pro and Agency cards.
 *   4. Falls back to a mailto CTA if Stripe is unreachable.
 *
 * Pricing (annual rates; monthly fallback):
 *   Free    → $0         (1 episode ever, one-time trial, no card)
 *   Pro     → $29/mo     ($348/yr — Founding Member price-locked forever; $41 monthly)
 *   Agency  → $149/mo    ($1,788/yr — Founding Member price-locked forever; $199 monthly)
 *
 * HUMAN REVIEW NOTES:
 * - CheckoutButton is a Client Component — reads localStorage "podlever_billing_period"
 *   to pick the right Stripe price ID (annual vs monthly) without prop drilling.
 * - The `?upgrade=pro|agency` flow auto-fires a server-side redirect to
 *   /rpc/billing/upgrade — no client JS needed for billing-dashboard CTAs.
 * - If Stripe product fetch fails, `proPrices` / `agencyPrices` will be null and
 *   the cards fall back to a mailto CTA (graceful degradation).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PricingToggle } from "@/app/components/PricingToggle";
import { CheckoutButton } from "@/app/components/CheckoutButton";
import { getAuthUser } from "@/providers/auth";
import { getStripeClient } from "@/lib/stripe";

// ─── Page metadata ────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Founding Member Pricing — PodLever Podcast Content Engine",
  description:
    "Lock in your price forever as a Founding Member. PodLever turns raw episodes into transcripts, show notes, blog posts, and social clips — from $0/month.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Founding Member Pricing — PodLever",
    description:
      "Founding Member rates: Pro ($29/mo) and Agency ($149/mo) — price locked forever, cancel anytime.",
    url: "/pricing",
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Stripe price IDs for a single tier — one for annual billing, one for monthly.
 * Both are required to render the CheckoutButton. If either is missing, the
 * card falls back to a mailto CTA.
 */
interface TierPrices {
  annual: string;   // Stripe price ID for annual billing
  monthly: string;  // Stripe price ID for monthly billing
}

// ─── Static pricing data ──────────────────────────────────────────────────────

/** Monthly-equivalent dollar amounts shown in the UI for each billing period. */
const DISPLAY_PRICES = {
  free:   { annual: 0,   monthly: 0   },
  pro:    { annual: 29,  monthly: 41  },
  agency: { annual: 149, monthly: 199 },
} as const;

type Tier = "free" | "pro" | "agency";

const FEATURES: Array<{
  category: string;
  items: Array<{ label: string; free: string | boolean; pro: string | boolean; agency: string | boolean }>;
}> = [
  {
    category: "Processing",
    items: [
      { label: "Episodes per month",      free: "1 (trial)", pro: "10",       agency: "50" },
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
      { label: "Revision requests",       free: "1/ep", pro: "3/ep",         agency: "3/ep"        },
      { label: "Team seats",              free: "1",    pro: "1",            agency: "5"           },
      { label: "Roadmap voting",          free: false,  pro: true,           agency: true          },
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

// ─── Stripe price fetch ───────────────────────────────────────────────────────

/**
 * fetchTierPrices — fetch annual + monthly Stripe price IDs for a plan slug.
 *
 * Filters Stripe products by `metadata.plan_slug` (e.g. "pro", "agency"),
 * then returns the two active prices tagged annual/monthly in their metadata.
 * Returns null if the product isn't found or Stripe is unreachable.
 *
 * @param slug - The plan_slug value set in Stripe product metadata.
 */
async function fetchTierPrices(slug: string): Promise<TierPrices | null> {
  try {
    const stripe = await getStripeClient();

    // List products filtered by metadata — Stripe supports direct metadata filters.
    const products = await stripe.products.list({
      active: true,
      limit: 10,
    });

    // Find the product whose metadata.plan_slug matches the requested slug.
    const product = products.data.find(
      (p: { metadata?: Record<string, string> }) => p.metadata?.plan_slug === slug,
    );
    if (!product) return null;

    // Fetch active prices for this product.
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 10,
    });

    // Pick out the annual and monthly prices by their metadata.billing_period tag.
    type PriceWithMeta = { id: string; metadata?: Record<string, string> };
    const annualPrice  = prices.data.find((p: PriceWithMeta) => p.metadata?.billing_period === "annual");
    const monthlyPrice = prices.data.find((p: PriceWithMeta) => p.metadata?.billing_period === "monthly");

    if (!annualPrice || !monthlyPrice) return null;

    return { annual: annualPrice.id, monthly: monthlyPrice.id };
  } catch {
    // Stripe is unreachable — cards will fall back to a mailto CTA.
    return null;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * PricingPage — Founding Member pricing with live Stripe Checkout (Server Component).
 *
 * Handles the `?upgrade=<plan>` auto-trigger: logged-in users who arrive from
 * the billing dashboard are redirected server-side to /rpc/billing/upgrade
 * so no client JS is required for the upgrade CTA.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string; upgrade?: string; error?: string }>;
}) {
  const params = await searchParams;

  // ── Auto-trigger: ?upgrade=pro or ?upgrade=agency ─────────────────────────
  // Billing dashboard links here with ?upgrade=<plan>. If the user is logged
  // in, immediately redirect them to the upgrade API route to create a Checkout
  // session server-side without any client JS interaction.
  if (params.upgrade === "pro" || params.upgrade === "agency") {
    const user = await getAuthUser();
    if (user) {
      // Pass through the billing period if the dashboard sent one.
      const billingParam = params.billing ? `&billing=${params.billing}` : "";
      redirect(`/rpc/billing/upgrade?plan=${params.upgrade}${billingParam}`);
    }
    // Not logged in — fall through and render the page normally.
    // The user will see the card and can log in before clicking Checkout.
  }

  // ── Fetch live Stripe price IDs ───────────────────────────────────────────
  // Run both fetches in parallel to keep render latency low.
  const [proPrices, agencyPrices] = await Promise.all([
    fetchTierPrices("pro"),
    fetchTierPrices("agency"),
  ]);

  // ── Checkout error banner copy ────────────────────────────────────────────
  const checkoutError = params.error === "checkout"
    ? "We couldn't start checkout. Please try again or email hi@podlever.com."
    : null;

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

      {/* Checkout error banner */}
      {checkoutError && (
        <div
          role="alert"
          className="bg-red-950/60 border-b border-red-800/60 px-6 py-3 text-center text-sm text-red-300"
        >
          {checkoutError}
        </div>
      )}

      {/* Header */}
      <section className="relative overflow-hidden pt-20 pb-16 px-6 text-center" aria-labelledby="pricing-heading">
        {/* Ambient glow */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex justify-center">
          <div className="w-[500px] h-[300px] rounded-full bg-amber-500/6 blur-[100px] mt-8" />
        </div>
        <div className="relative max-w-3xl mx-auto space-y-5">
          <p className="text-amber-400 text-sm font-semibold uppercase tracking-wider">
            Founding Member Pricing
          </p>
          <h1
            id="pricing-heading"
            className="text-5xl sm:text-6xl font-bold tracking-tight text-white leading-tight"
          >
            Lock in your rate.{" "}
            <span className="text-amber-400">Forever.</span>
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed max-w-xl mx-auto">
            Founding Members get today&apos;s price locked for the life of their
            subscription. As PodLever grows, prices will rise — yours won&apos;t.
          </p>
          {/* Founding Member value props */}
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            {[
              "Price locked forever",
              "Cancel anytime",
              "Roadmap voting",
              "Funds active development",
            ].map((prop) => (
              <span
                key={prop}
                className="px-3 py-1.5 rounded-full border border-amber-500/20 bg-amber-500/8 text-amber-300 text-xs font-medium"
              >
                {prop}
              </span>
            ))}
          </div>
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

            {/* Free */}
            <TierCard
              tier="free"
              name="Free trial"
              tagline="Try PodLever once, free"
              displayPrices={DISPLAY_PRICES.free}
              highlight={false}
              badge={null}
              cta={{ kind: "link", href: "/auth/login", label: "Start free trial", variant: "outline" }}
              perks={[
                "1 episode — one-time trial",
                "Transcript + show notes",
                "Cleaned audio export",
                "60-minute max file duration",
                "No credit card required",
              ]}
            />

            {/* Pro */}
            <TierCard
              tier="pro"
              name="Pro"
              tagline="For serious podcasters"
              displayPrices={DISPLAY_PRICES.pro}
              highlight={true}
              badge="Founding Member"
              cta={
                proPrices
                  ? { kind: "checkout", prices: proPrices, label: "Become a Founding Member", variant: "primary" }
                  : { kind: "mailto", label: "Contact us to join Pro", variant: "primary" }
              }
              perks={[
                "10 episodes per month",
                "All 8 output assets",
                "Priority processing queue",
                "4-hour max file duration",
                "3 revisions per episode",
                "Roadmap voting rights",
                "Email support",
                "Extra episodes $4 each",
              ]}
            />

            {/* Agency */}
            <TierCard
              tier="agency"
              name="Agency"
              tagline="For production teams"
              displayPrices={DISPLAY_PRICES.agency}
              highlight={false}
              badge={null}
              cta={
                agencyPrices
                  ? { kind: "checkout", prices: agencyPrices, label: "Become a Founding Member", variant: "outline" }
                  : { kind: "mailto", label: "Contact us to join Agency", variant: "outline" }
              }
              perks={[
                "50 episodes per month",
                "All 8 output assets",
                "Priority processing",
                "5 team seats",
                "3 revisions per episode",
                "Roadmap voting rights",
                "White-label exports",
                "API access",
                "Priority email support (24h SLA)",
                "Extra episodes $3 each",
              ]}
            />
          </div>

          {/* Annual savings note */}
          <p className="text-center text-zinc-500 text-sm">
            Annual billing saves up to{" "}
            <span className="text-amber-400 font-medium">29%</span> vs. monthly.
            Cancel anytime. Founding Member price locked for life.
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

      {/* FAQ */}
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
                q: "Why pay for something still being built?",
                a: "Because Founding Members get two things money can't buy later: a price that never increases and a direct line to shape what gets built. Your subscription covers infrastructure, AI processing costs, and active development. In return, you get today's rate locked forever — and roadmap voting so the features you care about get prioritised.",
              },
              {
                q: "What does 'price locked forever' actually mean?",
                a: "If you subscribe today at $29/mo, you pay $29/mo for as long as you stay subscribed — even if Pro goes to $49, $69, or more in the future. The price lock holds until you cancel. If you cancel and re-subscribe later, you rejoin at the current rate.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. No lock-in, no cancellation fees. Cancel from your billing dashboard and you keep access until the end of your paid period. Annual plans are non-refundable after the first 14 days, but you're never trapped.",
              },
              {
                q: "How does the free trial work?",
                a: "You get one episode processed for free — no credit card required. Use it to see exactly what PodLever produces before committing. Once your trial episode is done, you'll need to upgrade to continue.",
              },
              {
                q: "What audio/video formats do you support?",
                a: "MP3, MP4, WAV, M4A, and MOV. Free trial: up to 60 minutes. Pro and Agency: up to 4 hours. More formats coming — Founding Members vote on what comes next.",
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
            Start free today — no credit card, no commitment.
            Lock in Founding Member pricing before rates change.
          </p>
          <div className="flex flex-col items-center gap-4">
            <Link
              href="/auth/login"
              className="w-full max-w-xs px-8 py-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-base transition-colors text-center"
            >
              Start free — no card needed
            </Link>
            {proPrices && (
              <div className="w-full max-w-xs">
                <CheckoutButton
                  tier="pro"
                  annualPriceId={proPrices.annual}
                  monthlyPriceId={proPrices.monthly}
                  label="Join Pro as Founding Member"
                  variant="outline"
                />
              </div>
            )}
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

/** CTA descriptor — either a plain link, a Stripe Checkout button, or a mailto fallback. */
type TierCta =
  | { kind: "link";     href: string;      label: string; variant: "primary" | "outline" }
  | { kind: "checkout"; prices: TierPrices; label: string; variant: "primary" | "outline" }
  | { kind: "mailto";                       label: string; variant: "primary" | "outline" };

interface TierCardProps {
  tier: Tier;
  name: string;
  tagline: string;
  displayPrices: { annual: number; monthly: number };
  highlight: boolean;
  badge: string | null;
  cta: TierCta;
  perks: string[];
}

/**
 * TierCard — renders a single pricing plan card.
 *
 * Price display uses data attributes (data-tier, data-annual, data-monthly)
 * so PricingToggle's client-side script can swap values without re-rendering.
 * CTA is determined by the `cta` prop: link → <Link>, checkout → <CheckoutButton>,
 * mailto → <a href="mailto:..."> (graceful degradation if Stripe is unreachable).
 */
function TierCard({
  tier,
  name,
  tagline,
  displayPrices,
  highlight,
  badge,
  cta,
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
      {/* Founding Member / popular badge */}
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 rounded-full bg-amber-400 text-zinc-950 text-xs font-bold whitespace-nowrap">
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

        {/* Price display — client toggle swaps data-annual / data-monthly values */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-4xl font-bold text-white"
              data-tier={tier}
              data-annual={displayPrices.annual}
              data-monthly={displayPrices.monthly}
            >
              ${displayPrices.annual}
            </span>
            <span className="text-zinc-500 text-sm">/mo</span>
          </div>
          {displayPrices.annual > 0 && (
            <p className="text-zinc-600 text-xs" data-billing-note={tier}>
              billed annually · ${displayPrices.monthly}/mo billed monthly
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
      <div className="mt-6">
        {cta.kind === "link" && (
          <Link
            href={cta.href}
            className={[
              "block w-full py-3 px-5 rounded-xl text-sm font-semibold text-center transition-colors",
              cta.variant === "primary"
                ? "bg-amber-400 hover:bg-amber-300 text-zinc-950"
                : "border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white",
            ].join(" ")}
          >
            {cta.label}
          </Link>
        )}

        {cta.kind === "checkout" && (
          <CheckoutButton
            tier={tier === "pro" ? "pro" : "agency"}
            annualPriceId={cta.prices.annual}
            monthlyPriceId={cta.prices.monthly}
            label={cta.label}
            variant={cta.variant}
          />
        )}

        {cta.kind === "mailto" && (
          <a
            href="mailto:hi@podlever.com?subject=Founding Member enquiry"
            className={[
              "block w-full py-3 px-5 rounded-xl text-sm font-semibold text-center transition-colors",
              cta.variant === "primary"
                ? "bg-amber-400 hover:bg-amber-300 text-zinc-950"
                : "border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white",
            ].join(" ")}
          >
            {cta.label}
          </a>
        )}
      </div>
    </div>
  );
}

/** Renders a feature cell: boolean → checkmark/dash, string → text. */
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
