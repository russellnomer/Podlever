/**
 * scripts/setup-stripe-live.ts — One-command live Stripe setup
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (Task #14 completion — close the revenue loop)
 *
 * Creates everything the billing system needs in the Stripe account that
 * STRIPE_SECRET_KEY points to:
 *
 *   1. Products  — "PodLever Pro" (metadata.plan_slug=pro) and
 *                  "PodLever Agency" (metadata.plan_slug=agency)
 *   2. Prices    — per product: annual + monthly, tagged
 *                  metadata.billing_period=annual|monthly
 *                  (pricing from lib/tiers.ts: Pro $29/mo annual = $348/yr,
 *                   $41 monthly; Agency $149/mo annual = $1,788/yr, $199 monthly)
 *   3. Webhook   — https://podlever.com/api/billing/webhook subscribed to the
 *                  5 events the webhook route handles. Prints the signing
 *                  secret — ADD IT AS THE REPLIT SECRET `STRIPE_WEBHOOK_SECRET`.
 *
 * IDEMPOTENT: safe to run repeatedly. Existing products (matched by
 * plan_slug), prices (matched by billing_period + amount), and the webhook
 * endpoint (matched by URL) are reused, never duplicated. Note: Stripe only
 * reveals a webhook signing secret at creation time — if the endpoint already
 * exists, fetch the secret from the Stripe dashboard instead.
 *
 * RUN (Replit shell, where STRIPE_SECRET_KEY is set):
 *   cd artifacts/podlever && pnpm stripe:setup
 */

import Stripe from "stripe";
import { TIERS } from "../lib/tiers";

const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "https://podlever.com/api/billing/webhook";

const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

interface PlanSpec {
  slug:          "pro" | "agency";
  name:          string;
  description:   string;
  annualCents:   number; // total per YEAR
  monthlyCents:  number; // total per MONTH
}

function buildPlanSpecs(): PlanSpec[] {
  const pro    = TIERS.pro;
  const agency = TIERS.agency;
  return [
    {
      slug:         "pro",
      name:         "PodLever Pro",
      description:  `${pro.episodesPerMonth} episodes/month, 4-hour files, full content package for every episode.`,
      annualCents:  pro.pricePerMonthAnnual * 12 * 100,
      monthlyCents: pro.pricePerMonthMonthly * 100,
    },
    {
      slug:         "agency",
      name:         "PodLever Agency",
      description:  `${agency.episodesPerMonth} episodes/month, 4-hour files, built for teams managing multiple shows.`,
      annualCents:  agency.pricePerMonthAnnual * 12 * 100,
      monthlyCents: agency.pricePerMonthMonthly * 100,
    },
  ];
}

/** Find or create the product for a plan slug. */
async function ensureProduct(stripe: Stripe, spec: PlanSpec): Promise<Stripe.Product> {
  const existing = await stripe.products.list({ active: true, limit: 100 });
  const found = existing.data.find((p) => p.metadata?.plan_slug === spec.slug);
  if (found) {
    console.log(`  ✓ Product exists: ${found.name} (${found.id})`);
    return found;
  }
  const product = await stripe.products.create({
    name:        spec.name,
    description: spec.description,
    metadata:    { plan_slug: spec.slug },
  });
  console.log(`  + Created product: ${product.name} (${product.id})`);
  return product;
}

/** Find or create a recurring price on a product. */
async function ensurePrice(
  stripe: Stripe,
  product: Stripe.Product,
  billingPeriod: "annual" | "monthly",
  unitAmount: number,
): Promise<Stripe.Price> {
  const interval: "year" | "month" = billingPeriod === "annual" ? "year" : "month";
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const found = prices.data.find(
    (p) =>
      p.metadata?.billing_period === billingPeriod &&
      p.unit_amount === unitAmount &&
      p.recurring?.interval === interval,
  );
  if (found) {
    console.log(`  ✓ Price exists: ${billingPeriod} $${(unitAmount / 100).toFixed(2)}/${interval} (${found.id})`);
    return found;
  }

  // Deactivate any stale price with the same billing_period tag but a
  // different amount, so the pricing page never picks up an outdated price.
  for (const stale of prices.data) {
    if (stale.metadata?.billing_period === billingPeriod && stale.unit_amount !== unitAmount) {
      await stripe.prices.update(stale.id, { active: false });
      console.log(`  - Deactivated stale ${billingPeriod} price ${stale.id} ($${((stale.unit_amount ?? 0) / 100).toFixed(2)})`);
    }
  }

  const price = await stripe.prices.create({
    product:     product.id,
    currency:    "usd",
    unit_amount: unitAmount,
    recurring:   { interval },
    metadata:    { billing_period: billingPeriod },
  });
  console.log(`  + Created price: ${billingPeriod} $${(unitAmount / 100).toFixed(2)}/${interval} (${price.id})`);
  return price;
}

/** Find or create the fulfillment webhook endpoint. */
async function ensureWebhook(stripe: Stripe): Promise<void> {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = endpoints.data.find((e) => e.url === WEBHOOK_URL);
  if (found) {
    console.log(`  ✓ Webhook exists: ${WEBHOOK_URL} (${found.id})`);
    console.log("    (Signing secret is only shown at creation — find it in");
    console.log("     dashboard.stripe.com → Developers → Webhooks if you need it again.)");
    return;
  }
  const endpoint = await stripe.webhookEndpoints.create({
    url:            WEBHOOK_URL,
    enabled_events: WEBHOOK_EVENTS,
    description:    "PodLever payment fulfillment (plan sync)",
  });
  console.log(`  + Created webhook: ${WEBHOOK_URL} (${endpoint.id})`);
  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────────────┐");
  console.log("  │  ACTION REQUIRED — add this Replit Secret:                  │");
  console.log("  │                                                             │");
  console.log(`  │  STRIPE_WEBHOOK_SECRET = ${endpoint.secret}`);
  console.log("  │                                                             │");
  console.log("  │  (Shown ONCE. Without it, payments won't upgrade plans.)    │");
  console.log("  └─────────────────────────────────────────────────────────────┘");
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set. Run this in the Replit shell where secrets are available.");
    process.exit(1);
  }
  const stripe = new Stripe(key);

  const mode = key.startsWith("sk_live") ? "LIVE" : "TEST";
  console.log(`\nPodLever Stripe setup — ${mode} mode\n`);

  for (const spec of buildPlanSpecs()) {
    console.log(`${spec.name} (plan_slug=${spec.slug}):`);
    const product = await ensureProduct(stripe, spec);
    await ensurePrice(stripe, product, "annual", spec.annualCents);
    await ensurePrice(stripe, product, "monthly", spec.monthlyCents);
    console.log("");
  }

  console.log("Webhook endpoint:");
  await ensureWebhook(stripe);

  console.log("\nDone. Verify at https://dashboard.stripe.com → Product catalog.");
  console.log("Then hard-refresh https://podlever.com/pricing — the paid cards");
  console.log("should now show live checkout buttons instead of email links.\n");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
