/**
 * app/api/billing/portal-redirect/route.ts — GET redirect to Stripe portal
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * GET /api/billing/portal-redirect
 * Used by the billing page "Manage subscription" link (no JS required).
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  // request.url is the internal proxy origin on Replit Autoscale (0.0.0.0:3000);
  // always redirect via the real public origin.
  const appOrigin   = new URL(getCallbackUrl(request)).origin;
  const cookieStore = await cookies();
  const session     = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  if (!session.userId) {
    return NextResponse.redirect(new URL("/auth/login", appOrigin));
  }

  try {
    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, session.userId));

    if (!user?.stripeCustomerId) {
      return NextResponse.redirect(new URL("/pricing", appOrigin));
    }

    const stripe = await getStripeClient();
    const portal = await stripe.billingPortal.sessions.create({
      customer:   user.stripeCustomerId,
      return_url: `${appOrigin}/dashboard/billing`,
    });

    return NextResponse.redirect(portal.url);
  } catch {
    return NextResponse.redirect(new URL("/dashboard/billing?error=portal", appOrigin));
  }
}
