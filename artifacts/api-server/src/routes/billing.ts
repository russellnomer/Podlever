/**
 * routes/billing.ts — Billing-related API routes
 *
 * Part of: PodLever API Server
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Routes:
 *   GET  /api/billing/plans                    — active products + prices
 *   POST /api/billing/checkout                 — create Checkout session
 *   POST /api/billing/portal                   — create Customer Portal session
 *   GET  /api/billing/subscription/:userId     — subscription status
 *
 * Internal auth: X-Podlever-Internal: <CRON_SECRET> header (shared secret).
 * /billing/plans is public (prices only, no customer data).
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import { getUncachableStripeClient } from "../stripeClient";
import { db }                        from "../db";
import { users }                     from "../schema";
import { eq }                        from "drizzle-orm";

const router = Router();

// ─── Internal auth middleware ─────────────────────────────────────────────────

function requireInternal(req: Request, res: Response, next: NextFunction): void {
  const secret   = req.headers["x-podlever-internal"];
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ─── GET /api/billing/plans ───────────────────────────────────────────────────

router.get("/billing/plans", async (_req: Request, res: Response) => {
  try {
    const stripe   = await getUncachableStripeClient();
    const products = await stripe.products.list({ active: true });

    const plans = await Promise.all(
      products.data
        .filter((p) => p.metadata.plan_slug)
        .map(async (product) => {
          const prices = await stripe.prices.list({ product: product.id, active: true });
          return {
            productId: product.id,
            name:      product.name,
            planSlug:  product.metadata.plan_slug,
            prices:    prices.data.map((price) => ({
              priceId:  price.id,
              amount:   price.unit_amount,
              currency: price.currency,
              interval: (price.recurring as { interval: string } | null)?.interval ?? null,
            })),
          };
        }),
    );

    res.json({ plans });
  } catch (err: unknown) {
    console.error(JSON.stringify({ event: "billing.plans.error", error: String(err) }));
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

// ─── POST /api/billing/checkout ───────────────────────────────────────────────

router.post(
  "/billing/checkout",
  requireInternal as RequestHandler,
  async (req: Request, res: Response) => {
    const { userId, priceId, successUrl, cancelUrl } = req.body as {
      userId: string;
      priceId: string;
      successUrl: string;
      cancelUrl: string;
    };

    if (!userId || !priceId || !successUrl || !cancelUrl) {
      res.status(400).json({ error: "userId, priceId, successUrl, cancelUrl required" });
      return;
    }

    try {
      const stripe = await getUncachableStripeClient();
      const [user] = await db.select().from(users).where(eq(users.id, userId));

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { podlever_user_id: userId },
        });
        customerId = customer.id;
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
      }

      const session = await stripe.checkout.sessions.create({
        customer:             customerId,
        payment_method_types: ["card"],
        line_items:           [{ price: priceId, quantity: 1 }],
        mode:                 "subscription",
        success_url:          successUrl,
        cancel_url:           cancelUrl,
      });

      res.json({ url: session.url });
    } catch (err: unknown) {
      console.error(JSON.stringify({ event: "billing.checkout.error", error: String(err) }));
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  },
);

// ─── POST /api/billing/portal ─────────────────────────────────────────────────

router.post(
  "/billing/portal",
  requireInternal as RequestHandler,
  async (req: Request, res: Response) => {
    const { userId, returnUrl } = req.body as { userId: string; returnUrl: string };
    if (!userId || !returnUrl) {
      res.status(400).json({ error: "userId and returnUrl required" });
      return;
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user?.stripeCustomerId) {
        res.status(404).json({ error: "No Stripe customer found for this user" });
        return;
      }

      const stripe  = await getUncachableStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer:   user.stripeCustomerId,
        return_url: returnUrl,
      });

      res.json({ url: session.url });
    } catch (err: unknown) {
      console.error(JSON.stringify({ event: "billing.portal.error", error: String(err) }));
      res.status(500).json({ error: "Failed to create portal session" });
    }
  },
);

// ─── GET /api/billing/subscription/:userId ────────────────────────────────────

router.get(
  "/billing/subscription/:userId",
  requireInternal as RequestHandler,
  async (req: Request, res: Response) => {
    const userId = req.params["userId"] as string;
    try {
      const [user] = await db
        .select({
          plan:              users.plan,
          stripeCustomerId:  users.stripeCustomerId,
          planPeriodEnd:     users.planPeriodEnd,
          paymentGraceUntil: users.paymentGraceUntil,
        })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({
        plan:              user.plan,
        hasStripe:         !!user.stripeCustomerId,
        planPeriodEnd:     user.planPeriodEnd?.toISOString() ?? null,
        paymentGraceUntil: user.paymentGraceUntil?.toISOString() ?? null,
        inGrace:           user.paymentGraceUntil
          ? user.paymentGraceUntil > new Date()
          : false,
      });
    } catch (err: unknown) {
      console.error(JSON.stringify({ event: "billing.subscription.error", error: String(err) }));
      res.status(500).json({ error: "Failed to fetch subscription" });
    }
  },
);

export default router;
