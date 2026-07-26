/**
 * app/api/billing/upgrade/route.ts — Server-side Stripe Checkout redirect
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #58 — pricing page Stripe Checkout)
 *
 * GET /api/billing/upgrade?plan=pro&billing=annual
 *
 * Used by the pricing page when a logged-in user lands with ?upgrade=<plan>.
 * Keeps the checkout initiation fully server-side — no client JS required for
 * the auto-trigger path.
 *
 * Auth:    iron-session. Unauthenticated → redirect to login.
 * Params:  plan    = "pro" | "agency"
 *          billing = "annual" | "monthly"  (default: annual)
 * Returns: 302 redirect to Stripe Checkout URL on success.
 *          302 redirect to /pricing?error=checkout on failure.
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies }                        from "next/headers";
import { getIronSession }                 from "iron-session";
import { getCallbackUrl, getSessionOptions } from "@/providers/auth";
import { getStripeClient }                from "@/lib/stripe";
import { db }                             from "@/db";
import { users }                          from "@/db/schema";
import { eq }                             from "drizzle-orm";
import type { PodLeverSession }           from "@/providers/auth";

/** Stripe product metadata keys → plan slug. */
const VALID_PLANS = new Set(["pro", "agency"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const plan    = searchParams.get("plan") ?? "";
  const billing = searchParams.get("billing") === "monthly" ? "monthly" : "annual";
  // request.nextUrl.origin is the internal proxy origin on Replit Autoscale
  // (0.0.0.0:3000) — derive the real public origin instead.
  const origin  = new URL(getCallbackUrl(request)).origin;

  // ── Validate plan param ───────────────────────────────────────────────────
  if (!VALID_PLANS.has(plan)) {
    return NextResponse.redirect(`${origin}/pricing`);
  }

  // ── Auth: redirect to login if not logged in ──────────────────────────────
  const cookieStore = await cookies();
  const session     = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  if (!session.userId) {
    const next = encodeURIComponent(`/pricing?upgrade=${plan}`);
    return NextResponse.redirect(`${origin}/auth/login?next=${next}`);
  }

  try {
    const stripe = await getStripeClient();

    // ── Find the Stripe price for the requested plan + billing period ─────
    const products = await stripe.products.list({ active: true, limit: 10 });
    const product  = products.data.find((p) => p.metadata["plan_slug"] === plan);
    if (!product) {
      return NextResponse.redirect(`${origin}/pricing?error=no_product`);
    }

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
    const price  = prices.data.find((p) =>
      billing === "annual"
        ? p.recurring?.interval === "year"
        : p.recurring?.interval === "month",
    );
    if (!price) {
      return NextResponse.redirect(`${origin}/pricing?error=no_price`);
    }

    // ── Get or create Stripe customer ─────────────────────────────────────
    const [user] = await db.select().from(users).where(eq(users.id, session.userId));
    if (!user) return NextResponse.redirect(`${origin}/auth/login`);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { podlever_user_id: session.userId },
      });
      customerId = customer.id;
      await db
        .update(users)
        .set({ stripeCustomerId: customerId })
        .where(eq(users.id, session.userId));
    }

    // ── Create Checkout session ───────────────────────────────────────────
    const checkoutSession = await stripe.checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ["card"],
      line_items:           [{ price: price.id, quantity: 1 }],
      mode:                 "subscription",
      success_url:          `${origin}/dashboard/billing?success=1`,
      cancel_url:           `${origin}/pricing`,
    });

    if (!checkoutSession.url) {
      return NextResponse.redirect(`${origin}/pricing?error=checkout`);
    }

    return NextResponse.redirect(checkoutSession.url);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "billing.upgrade.error", userId: session.userId, plan, error: String(err) }),
    );
    return NextResponse.redirect(`${origin}/pricing?error=checkout`);
  }
}
