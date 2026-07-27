/**
 * app/rpc/billing/portal/route.ts — Stripe Customer Portal session creator
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * POST /rpc/billing/portal
 * Returns: { url: string } — Stripe portal URL
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
  const cookieStore = await cookies();
  const session     = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, session.userId));

    if (!user?.stripeCustomerId) {
      return NextResponse.json({ error: "No Stripe customer found" }, { status: 404 });
    }

    const stripe  = await getStripeClient();
    const portal  = await stripe.billingPortal.sessions.create({
      customer:   user.stripeCustomerId,
      return_url: `${request.nextUrl.origin}/dashboard/billing`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (err) {
    console.error(JSON.stringify({ event: "billing.portal.error", userId: session.userId, error: String(err) }));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
