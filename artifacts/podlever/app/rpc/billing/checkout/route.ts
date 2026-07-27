/**
 * app/rpc/billing/checkout/route.ts — Stripe Checkout session creator
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * POST /rpc/billing/checkout
 *
 * Creates a Stripe Checkout session for the authenticated user.
 * Calls Stripe directly — no intermediate API server hop needed.
 *
 * Auth: iron-session.
 * Body: { priceId: string }
 * Returns: { url: string } — redirect to Stripe-hosted checkout
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies }                        from "next/headers";
import { getIronSession }                 from "iron-session";
import { getSessionOptions }              from "@/providers/auth";
import { getStripeClient }                from "@/lib/stripe";
import { db }                             from "@/db";
import { users }                          from "@/db/schema";
import { eq }                             from "drizzle-orm";
import type { PodLeverSession }           from "@/providers/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const session     = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const priceId = (body as Record<string, unknown>).priceId;
  if (typeof priceId !== "string" || !priceId.startsWith("price_")) {
    return NextResponse.json({ error: "Invalid priceId" }, { status: 400 });
  }

  // ── Create or retrieve Stripe customer ────────────────────────────────────
  try {
    const stripe = await getStripeClient();

    const [user] = await db.select().from(users).where(eq(users.id, session.userId));
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { podlever_user_id: session.userId },
      });
      customerId = customer.id;
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, session.userId));
    }

    // ── Create Checkout session ───────────────────────────────────────────
    const origin     = request.nextUrl.origin;
    const session2   = await stripe.checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ["card"],
      line_items:           [{ price: priceId, quantity: 1 }],
      mode:                 "subscription",
      success_url:          `${origin}/dashboard/billing?success=1`,
      cancel_url:           `${origin}/pricing`,
    });

    return NextResponse.json({ url: session2.url });
  } catch (err) {
    console.error(JSON.stringify({ event: "billing.checkout.error", userId: session.userId, error: String(err) }));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
