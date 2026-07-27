/**
 * webhookHandlers.ts — Stripe webhook processing for the API server
 *
 * Part of: PodLever API Server
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Responsibilities:
 *   1. stripe-replit-sync standard sync (stripe schema tables)
 *   2. Custom business logic: update public.users plan + Stripe fields
 *
 * SECURITY: Signature verified by stripe-replit-sync before any processing.
 */

import Stripe from "stripe";
import { getStripeSync, getUncachableStripeClient } from "./stripeClient";
import { db }    from "./db";
import { users } from "./schema";
import { eq, sql }    from "drizzle-orm";

const GRACE_PERIOD_DAYS = 7;

// ─── Plan resolution ──────────────────────────────────────────────────────────

interface SubscriptionItem {
  price: {
    product: string | { id: string; metadata: Record<string, string> };
  };
}

async function planSlugFromItems(
  stripe: Stripe,
  items: SubscriptionItem[],
): Promise<string> {
  const firstItem = items[0];
  if (!firstItem) return "free";

  const product = firstItem.price.product;
  let metadata: Record<string, string> = {};

  if (typeof product === "string") {
    const prod = await stripe.products.retrieve(product);
    metadata = prod.metadata as Record<string, string>;
  } else {
    metadata = product.metadata;
  }

  return metadata.plan_slug ?? "pro";
}

// ─── Application event handler ────────────────────────────────────────────────

async function handleStripeEvent(
  stripe: Stripe,
  event: { type: string; data: { object: Record<string, unknown> } },
): Promise<void> {
  switch (event.type) {

    case "checkout.session.completed": {
      const session = event.data.object as {
        customer:     string;
        subscription: string | null;
      };
      if (!session.subscription) break;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = await stripe.subscriptions.retrieve(session.subscription, {
        expand: ["items.data.price.product"],
      }) as unknown as { current_period_end: number; items: { data: SubscriptionItem[] } };

      const planSlug  = await planSlugFromItems(stripe, sub.items.data);
      const periodEnd = new Date(sub.current_period_end * 1000);

      await db.update(users)
        .set({
          plan:                 planSlug,
          stripeCustomerId:     session.customer,
          stripeSubscriptionId: session.subscription,
          planPeriodEnd:        periodEnd,
          paymentGraceUntil:    null,
        })
        .where(eq(users.stripeCustomerId, session.customer));

      console.log(JSON.stringify({ event: "stripe.checkout.completed", customerId: session.customer, plan: planSlug }));

      // Lead-to-cash funnel (2026-07-27): close the loop on the waitlist row.
      // Raw SQL because api-server's schema.ts only maps `users`; the waitlist
      // row is matched via users.external_identity_id → waitlist.replit_user_id.
      try {
        await db.execute(sql`
          UPDATE waitlist
             SET status       = 'converted',
                 converted_at = COALESCE(converted_at, now()),
                 updated_at   = now()
           WHERE replit_user_id = (
                   SELECT external_identity_id FROM users
                    WHERE stripe_customer_id = ${session.customer}
                    LIMIT 1
                 )
        `);
        console.log(JSON.stringify({ event: "funnel.lead_converted", customerId: session.customer }));
      } catch (err) {
        // Never fail the webhook over funnel bookkeeping
        console.error(JSON.stringify({ event: "funnel.convert_stamp_failed", error: String(err) }));
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as {
        customer:           string;
        status:             string;
        current_period_end: number;
        items:              { data: SubscriptionItem[] };
      };
      const planSlug   = await planSlugFromItems(stripe, sub.items.data);
      const activePlan = sub.status === "active" ? planSlug : "free";
      const periodEnd  = new Date(sub.current_period_end * 1000);

      await db.update(users)
        .set({ plan: activePlan, planPeriodEnd: periodEnd, paymentGraceUntil: null })
        .where(eq(users.stripeCustomerId, sub.customer));

      console.log(JSON.stringify({ event: "stripe.subscription.updated", customerId: sub.customer, plan: activePlan }));
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as { customer: string };

      await db.update(users)
        .set({ plan: "free", stripeSubscriptionId: null, planPeriodEnd: null, paymentGraceUntil: null })
        .where(eq(users.stripeCustomerId, sub.customer));

      console.log(JSON.stringify({ event: "stripe.subscription.deleted", customerId: sub.customer }));
      break;
    }

    case "invoice.payment_failed": {
      const invoice    = event.data.object as { customer: string };
      const graceUntil = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

      await db.update(users)
        .set({ paymentGraceUntil: graceUntil })
        .where(eq(users.stripeCustomerId, invoice.customer));

      console.log(JSON.stringify({ event: "stripe.payment.failed", customerId: invoice.customer, graceUntil: graceUntil.toISOString() }));
      break;
    }

    default:
      break;
  }
}

// ─── Public handler ────────────────────────────────────────────────────────────

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
        "FIX: Register webhook route BEFORE app.use(express.json()).",
      );
    }

    // 1. stripe-replit-sync: validate + sync stripe schema tables
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // 2. Custom business logic — parse event from already-verified payload
    try {
      const stripe = await getUncachableStripeClient();
      const event  = JSON.parse(payload.toString()) as {
        type: string;
        data: { object: Record<string, unknown> };
      };
      await handleStripeEvent(stripe, event).catch((err) =>
        console.error(JSON.stringify({ event: "stripe.custom_handler.error", error: String(err) })),
      );
    } catch (err) {
      console.error(JSON.stringify({ event: "stripe.event_parse.error", error: String(err) }));
    }
  }
}
