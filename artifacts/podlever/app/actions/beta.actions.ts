/**
 * app/actions/beta.actions.ts — Beta invite self-declaration and activation actions
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #55 — Beta invite & onboarding)
 *
 * Server Actions for the beta access flow:
 *
 *   claimBetaInviteAction   — called from /verify-access
 *     Matches the user's self-declared email against the waitlist.
 *     If a matching "invited" entry is found, links their replitUserId and
 *     updates the session cookie to betaAccess: "invited". Redirects to /onboarding.
 *
 *   activateBetaUserAction  — called from /onboarding CTA button
 *     Transitions the linked waitlist entry from "invited" → "active".
 *     Updates the session cookie to betaAccess: "active". Redirects to /dashboard/episodes/new.
 *
 * Security:
 *   - Both actions require an authenticated session (getAuthUser())
 *   - Email validated as proper email format before any DB query
 *   - No PII (email) in logs — only replitUserId
 *   - Rate limiting: not yet implemented for beta — add before public launch
 */

"use server";

import { z }               from "zod";
import { redirect }        from "next/navigation";
import { cookies }         from "next/headers";
import { getIronSession }  from "iron-session";
import { getAuthUser, getSessionOptions } from "@/providers/auth";
import { waitlistRepository }            from "@/repositories";
import type { PodLeverSession }          from "@/providers/auth";

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
  const emailResult = z
    .string()
    .email("Please enter a valid email address")
    .max(320)
    .transform((v) => v.toLowerCase().trim())
    .safeParse(formData.get("email"));

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

  redirect("/dashboard/episodes/new");
}
