/**
 * scripts/src/seed-products.ts — Create PodLever products + prices in Stripe
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Idempotent: checks for existing products before creating new ones.
 * Run manually in development to seed the Stripe account.
 *
 * Usage: pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
 *
 * Products created:
 *   Pro Plan    — $41/mo monthly, $29/mo annual ($348/yr)
 *   Agency Plan — $136/mo monthly, $97/mo annual ($1,164/yr)
 *
 * Product metadata.plan_slug is used by webhookHandlers.ts to map subscriptions
 * to users.plan values. Keep in sync with lib/tiers.ts.
 *
 * HUMAN REVIEW NOTES:
 *   - Run this script in development (test mode) first.
 *   - On deployment, Replit copies Stripe products from dev → prod automatically.
 *   - If you need to recreate a product, update its name slightly or delete in dashboard.
 */

import Stripe from "stripe";

// ─── Credential fetch (mirrors stripeClient.ts) ───────────────────────────────

async function getStripeClient(): Promise<Stripe> {
  // 1. Production env var
  if (process.env.STRIPE_SECRET_KEY) return new Stripe(process.env.STRIPE_SECRET_KEY);

  // 2. Dev secret added via Replit Secrets panel
  if (process.env.Stripe_secret_key_dev) return new Stripe(process.env.Stripe_secret_key_dev);

  // 3. Replit connector proxy
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME ?? "connectors.replit.com";
  const baseUrl  = hostname.startsWith("http") ? hostname : `https://${hostname}`;

  let token: string | null = null;
  if (process.env.REPL_IDENTITY)    token = `repl ${process.env.REPL_IDENTITY}`;
  if (process.env.WEB_REPL_RENEWAL) token = `depl ${process.env.WEB_REPL_RENEWAL}`;

  if (token) {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Replit-Token": token,
    };
    const resp = await fetch(
      `${baseUrl}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );
    const data = await resp.json() as { items?: Array<{ settings?: { secret_key?: string } }> };
    const key  = data.items?.[0]?.settings?.secret_key;
    if (key) return new Stripe(key);
  }

  throw new Error(
    "Stripe secret key not found. Set STRIPE_SECRET_KEY or Stripe_secret_key_dev in Replit Secrets.",
  );
}

// ─── Product definitions ──────────────────────────────────────────────────────

const PRODUCTS = [
  {
    name:      "PodLever Pro",
    planSlug:  "pro",
    description: "10 episodes/month · All assets · Priority processing",
    prices: [
      { interval: "month" as const, unitAmount: 4100,  label: "$41/mo monthly"  },
      { interval: "year"  as const, unitAmount: 34800, label: "$348/yr annual ($29/mo)" },
    ],
  },
  {
    name:      "PodLever Agency",
    planSlug:  "agency",
    description: "Unlimited episodes · White-label exports · 5 team seats",
    prices: [
      { interval: "month" as const, unitAmount: 13600,  label: "$136/mo monthly"  },
      { interval: "year"  as const, unitAmount: 116400, label: "$1,164/yr annual ($97/mo)" },
    ],
  },
] as const;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedProducts(): Promise<void> {
  const stripe = await getStripeClient();
  console.log("🔌 Connected to Stripe\n");

  for (const def of PRODUCTS) {
    // Check if the product already exists (idempotent by name)
    const existing = await stripe.products.search({
      query: `name:'${def.name}' AND active:'true'`,
    });

    let productId: string;
    if (existing.data.length > 0) {
      productId = existing.data[0]!.id;
      console.log(`✓ ${def.name} already exists (${productId})`);
    } else {
      const product = await stripe.products.create({
        name:        def.name,
        description: def.description,
        metadata:    { plan_slug: def.planSlug },
      });
      productId = product.id;
      console.log(`✚ Created ${def.name} (${productId})`);
    }

    // Create prices (always create if missing — prices are immutable in Stripe)
    const existingPrices = await stripe.prices.list({
      product: productId,
      active:  true,
    });

    for (const priceDef of def.prices) {
      const alreadyExists = existingPrices.data.some(
        (p) =>
          p.unit_amount === priceDef.unitAmount &&
          (p.recurring as { interval: string } | null)?.interval === priceDef.interval,
      );

      if (alreadyExists) {
        console.log(`  ✓ Price ${priceDef.label} already exists`);
      } else {
        const price = await stripe.prices.create({
          product:    productId,
          unit_amount: priceDef.unitAmount,
          currency:   "usd",
          recurring:  { interval: priceDef.interval },
          metadata:   { plan_slug: def.planSlug, billing: priceDef.interval },
        });
        console.log(`  ✚ Created price ${priceDef.label} (${price.id})`);
      }
    }

    console.log();
  }

  console.log("✅ Seeding complete. Webhooks will sync prices to the database automatically.");
  console.log("   Price IDs are visible in the Stripe dashboard → Products.");
}

seedProducts().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
