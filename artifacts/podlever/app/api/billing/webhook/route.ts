/**
 * app/api/billing/webhook/route.ts — Stripe webhook (payment fulfillment)
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (Task #14 completion — close the revenue loop)
 *
 * POST /api/billing/webhook
 *
 * Without this route, Checkout collects money but the app never learns about
 * it — the customer stays on the free plan. This webhook is the fulfillment
 * side of Stripe billing:
 *
 *   checkout.session.completed      → set users.plan from the purchased
 *                                     product's metadata.plan_slug
 *   customer.subscription.updated   → keep plan/period in sync (upgrades,
 *                                     downgrades, renewals, cancellations)
 *   customer.subscription.deleted   → downgrade to free
 *   invoice.paid                    → clear any payment grace period
 *   invoice.payment_failed          → start a 7-day grace period
 *
 * SETUP: the endpoint must be registered in Stripe (scripts/setup-stripe-live.ts
 * does this) and its signing secret stored as STRIPE_WEBHOOK_SECRET.
 *
 * HUMAN REVIEW NOTES:
 * - Signature verification uses the RAW request body (request.text()) —
 *   do not JSON-parse before constructEvent.
 * - Stripe API 2025+ (SDK v22): current_period_end lives on subscription
 *   ITEMS, not the subscription object.
 * - Users are looked up by stripe_customer_id (set at checkout creation).
 * - Unknown event types return 200 so Stripe doesn't retry them.
 * - Beta/admin-managed plans are never touched here: we only write plans
 *   derived from Stripe product metadata (pro/agency) or downgrade to free
 *   when a PAID subscription ends.
 */

import { type NextRequest, NextResponse } from "next/server";
import type Stripe                        from "stripe";
import { getStripeClient }                from "@/lib/stripe";
import { db }                             from "@/db";
import { users }                          from "@/db/schema";
import { eq }                             from "drizzle-orm";

/** Plans this webhook is allowed to write. Anything else is ignored. */
const PAID_PLANS = new Set(["pro", "agency"]);

/** Grace period after a failed payment, in days. */
const GRACE_DAYS = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the customer ID string from a Stripe customer field. */
function customerIdOf(customer: string | { id: string } | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * Resolve plan slug + period end from a subscription.
 * Reads metadata.plan_slug from the price's product (expanded or refetched).
 */
async function resolvePlanFromSubscription(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<{ planSlug: string | null; periodEnd: Date | null }> {
  const item = subscription.items?.data?.[0];
  if (!item) return { planSlug: null, periodEnd: null };

  // current_period_end lives on the item (Stripe API 2025+).
  const periodEnd = item.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  const productRef = item.price?.product;
  let planSlug: string | null = null;

  if (productRef && typeof productRef === "object" && "metadata" in productRef) {
    planSlug = (productRef as Stripe.Product).metadata?.plan_slug ?? null;
  } else if (typeof productRef === "string") {
    const product = await stripe.products.retrieve(productRef);
    planSlug = product.metadata?.plan_slug ?? null;
  }

  return { planSlug, periodEnd };
}

/** Apply a subscription's current state to the matching user row. */
async function syncSubscriptionToUser(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = customerIdOf(subscription.customer as string | { id: string });
  if (!customerId) return;

  const [user] = await db.select({ id: users.id, plan: users.plan })
    .from(users)
    .where(eq(users.stripeCustomerId, customerId));
  if (!user) {
    console.warn(JSON.stringify({ event: "billing.webhook.unknown_customer", customerId }));
    return;
  }

  const active = subscription.status === "active" || subscription.status === "trialing";

  if (active) {
    const { planSlug, periodEnd } = await resolvePlanFromSubscription(stripe, subscription);
    if (!planSlug || !PAID_PLANS.has(planSlug)) {
      console.warn(JSON.stringify({
        event: "billing.webhook.unknown_plan_slug",
        subscriptionId: subscription.id,
        planSlug,
      }));
      return;
    }
    await db.update(users).set({
      plan:                 planSlug,
      stripeSubscriptionId: subscription.id,
      planPeriodEnd:        periodEnd,
      paymentGraceUntil:    null,
    }).where(eq(users.id, user.id));
    console.log(JSON.stringify({
      event: "billing.plan.synced", userId: user.id, plan: planSlug,
      subscriptionStatus: subscription.status, ts: new Date().toISOString(),
    }));
    return;
  }

  // Subscription ended (canceled / unpaid / incomplete_expired): downgrade —
  // but only if the user is currently on a Stripe-managed paid plan. Never
  // touch admin-managed plans like "beta".
  if (
    (subscription.status === "canceled" ||
     subscription.status === "unpaid" ||
     subscription.status === "incomplete_expired") &&
    PAID_PLANS.has(user.plan)
  ) {
    await db.update(users).set({
      plan:                 "free",
      stripeSubscriptionId: null,
      planPeriodEnd:        null,
      paymentGraceUntil:    null,
    }).where(eq(users.id, user.id));
    console.log(JSON.stringify({
      event: "billing.plan.downgraded", userId: user.id,
      reason: subscription.status, ts: new Date().toISOString(),
    }));
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[billing.webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // RAW body required for signature verification.
  const rawBody = await request.text();

  let stripe: Stripe;
  let event: Stripe.Event;
  try {
    stripe = await getStripeClient();
    event  = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[billing.webhook] signature verification failed:", (err as Error).message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subscriptionId = typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["items.data.price.product"],
          });
          await syncSubscriptionToUser(stripe, subscription);
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        let subscription = event.data.object as Stripe.Subscription;
        // Ensure product metadata is available for plan resolution.
        if (subscription.status === "active" || subscription.status === "trialing") {
          subscription = await stripe.subscriptions.retrieve(subscription.id, {
            expand: ["items.data.price.product"],
          });
        }
        await syncSubscriptionToUser(stripe, subscription);
        break;
      }

      case "invoice.paid": {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = customerIdOf(invoice.customer as string | { id: string });
        if (customerId) {
          await db.update(users)
            .set({ paymentGraceUntil: null })
            .where(eq(users.stripeCustomerId, customerId));
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = customerIdOf(invoice.customer as string | { id: string });
        if (customerId) {
          const graceUntil = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
          await db.update(users)
            .set({ paymentGraceUntil: graceUntil })
            .where(eq(users.stripeCustomerId, customerId));
          console.log(JSON.stringify({
            event: "billing.grace.started", customerId,
            graceUntil: graceUntil.toISOString(),
          }));
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    console.error(JSON.stringify({
      event: "billing.webhook.handler_error",
      type:  event.type,
      error: String(err),
    }));
    // 500 → Stripe retries with backoff, which is what we want for
    // transient DB failures.
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
