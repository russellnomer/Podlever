/**
 * app/actions/beta.actions.ts — Beta invite self-declaration and activation actions
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-24 by agent (added requestAccessAction)
 *
 * Server Actions for the beta access flow:
 *
 *   claimBetaInviteAction   — called from /verify-access "Claim my invite" form
 *     Matches the user's self-declared email against the waitlist.
 *     If a matching "invited" entry is found, links their replitUserId and
 *     updates the session cookie to betaAccess: "invited". Redirects to /onboarding.
 *
 *   requestAccessAction     — called from /verify-access "Request access" form
 *     Inserts the email into the waitlist with status "new" (if not already present).
 *     Shows an on-screen confirmation. Owner sees the request in /admin/waitlist.
 *
 *   activateBetaUserAction  — called from /onboarding CTA button
 *     Transitions the linked waitlist entry from "invited" → "active".
 *     Updates the session cookie to betaAccess: "active". Redirects to /dashboard/episodes/new.
 *
 * Security:
 *   - claimBetaInviteAction and activateBetaUserAction require an authenticated session
 *   - requestAccessAction requires an authenticated session (we have replitUserId to link later)
 *   - Email validated as proper email format before any DB query
 *   - No PII (email) in logs — only replitUserId
 */

"use server";

import { z }               from "zod";
import { redirect }        from "next/navigation";
import { cookies }         from "next/headers";
import { getIronSession }  from "iron-session";
import { eq, and }         from "drizzle-orm";
import { getAuthUser, getSessionOptions } from "@/providers/auth";
import { waitlistRepository }            from "@/repositories";
import { db }                            from "@/db";
import { waitlist }                      from "@/db/schema";
import type { PodLeverSession }          from "@/providers/auth";

// ─── Email validator (shared) ─────────────────────────────────────────────────

const emailSchema = z
  .string()
  .email("Please enter a valid email address")
  .max(320)
  .transform((v) => v.toLowerCase().trim());

// ─── claimBetaInviteAction ─────────────────────────────────────────────────────

/**
 * claimBetaInviteAction — Verify email against the invite list and link the account.
 *
 * FormData fields:
 *   email: string — the email address the user signed up with
 *
 * Outcome:
 *   Success → links replitUserId to waitlist entry, updates session, redirects to /onboarding
 *   Email not found or not invited → redirects to /verify-access?error=not_invited
 *   Already claimed → redirects to /verify-access?error=already_claimed
 */
export async function claimBetaInviteAction(formData: FormData): Promise<never> {
  const session = await getAuthUser();
  if (!session?.userId || !session.replitUserId) redirect("/auth/login");

  // Validate email
  const emailResult = emailSchema.safeParse(formData.get("email"));
  if (!emailResult.success) {
    redirect("/verify-access?error=invalid_email");
  }
  const email = emailResult.data;

  // Find the waitlist entry by email with status "invited"
  let entry;
  try {
    entry = await waitlistRepository.findInvitedByEmail(email);
  } catch {
    redirect("/verify-access?error=lookup_failed");
  }

  if (!entry) {
    redirect("/verify-access?error=not_invited");
  }

  // Check if already claimed by someone else
  if (entry.replitUserId && entry.replitUserId !== session.replitUserId) {
    redirect("/verify-access?error=already_claimed");
  }

  // Link the Replit account to the waitlist entry
  try {
    await waitlistRepository.linkReplitUserId(entry.id, session.replitUserId);
  } catch {
    redirect("/verify-access?error=link_failed");
  }

  console.log(JSON.stringify({ event: "beta.invite.claimed", replitUserId: session.replitUserId, ts: new Date().toISOString() }));

  // Update session cookie: set betaAccess = "invited"
  // iron-session v8 in Server Actions: pass the ReadonlyRequestCookies from next/headers
  const cookieStore = await cookies();
  const ironSess = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  ironSess.betaAccess = "invited";
  await ironSess.save();

  redirect("/onboarding");
}

// ─── requestAccessAction ──────────────────────────────────────────────────────

/**
 * requestAccessAction — Record an access request from a non-invited user.
 *
 * FormData fields:
 *   email: string — the email address to add to the queue
 *
 * Outcome:
 *   Email already "invited" or "active"  → ?error=already_invited_claim (use claim form)
 *   Email already in queue (any status)  → ?error=already_requested
 *   New email                            → inserts with status "new", source "verify_access"
 *                                          → ?message=request_sent
 *
 * The owner sees all "new" requests at /admin/waitlist and can promote to "invited".
 * No email notification is sent (email service not configured — owner monitors /admin/waitlist).
 */
export async function requestAccessAction(formData: FormData): Promise<never> {
  const session = await getAuthUser();
  if (!session?.userId || !session.replitUserId) redirect("/auth/login");

  // Validate email
  const emailResult = emailSchema.safeParse(formData.get("email"));
  if (!emailResult.success) {
    redirect("/verify-access?error=invalid_email");
  }
  const email = emailResult.data;

  // Check if this email is already in the waitlist
  try {
    const [existing] = await db
      .select({ id: waitlist.id, status: waitlist.status })
      .from(waitlist)
      .where(eq(waitlist.email, email))
      .limit(1);

    if (existing) {
      // If they're already invited/active, send them to the claim form
      if (existing.status === "invited" || existing.status === "active") {
        redirect("/verify-access?error=already_invited_claim");
      }
      // Already in queue with any other status
      redirect("/verify-access?error=already_requested");
    }

    // Insert new access request — no replitUserId linked yet (owner invites manually)
    await db.insert(waitlist).values({
      email,
      source: "verify_access",
      status: "new",
    });

    console.log(JSON.stringify({
      event:        "beta.access.requested",
      replitUserId: session.replitUserId,
      ts:           new Date().toISOString(),
      // email intentionally not logged (PII)
    }));
  } catch (err) {
    // Avoid leaking DB errors to the user; log server-side
    const msg = (err as Error).message;
    // Check if this is one of our intentional redirects (next/navigation throws)
    if (msg.includes("NEXT_REDIRECT")) throw err;
    console.error("[requestAccessAction] DB error:", msg);
    redirect("/verify-access?error=lookup_failed");
  }

  redirect("/verify-access?message=request_sent");
}

// ─── activateBetaUserAction ───────────────────────────────────────────────────

/**
 * activateBetaUserAction — Transition the user's waitlist entry from invited → active.
 *
 * Called from the /onboarding page CTA. Sets betaAccess = "active" in the session
 * cookie so subsequent requests get full product access without a re-login.
 *
 * Idempotent: if the user is already "active", the session is updated and they
 * are redirected to the product.
 */
export async function activateBetaUserAction(): Promise<never> {
  const session = await getAuthUser();
  if (!session?.userId || !session.replitUserId) redirect("/auth/login");
  if (session.role === "owner") redirect("/dashboard/episodes/new");

  // Transition waitlist entry: invited → active
  try {
    await waitlistRepository.activateBetaUser(session.replitUserId);
  } catch {
    // Non-fatal — log and continue; user still gets session access
    console.error(JSON.stringify({ event: "beta.activate.failed", replitUserId: session.replitUserId, ts: new Date().toISOString() }));
  }

  console.log(JSON.stringify({ event: "beta.activate.success", replitUserId: session.replitUserId, ts: new Date().toISOString() }));

  // Update session cookie: betaAccess = "active"
  const cookieStore = await cookies();
  const ironSess = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  ironSess.betaAccess = "active";
  await ironSess.save();

  // Set user's plan to "beta" (pro-equivalent limits) in the DB
  try {
    const { db }    = await import("@/db");
    const { users } = await import("@/db/schema");
    const { eq }    = await import("drizzle-orm");
    await db.update(users).set({ plan: "beta" }).where(eq(users.id, session.userId));
  } catch (err) {
    console.error(JSON.stringify({ event: "beta.plan_set.failed", replitUserId: session.replitUserId, error: String(err) }));
  }

  redirect("/dashboard/episodes/new");
}
