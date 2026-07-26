/**
 * app/actions/admin.actions.ts — Owner-only admin server actions
 *
 * Part of: PodLever
 * Created: 2026-07-24 by agent (waitlist invite action for /admin/waitlist)
 *
 * Server Actions that require owner role.
 * All actions call requireOwnerFromSession() before any DB write.
 *
 * Security:
 *   - Every action verifies role === "owner" via requireOwnerFromSession()
 *   - No PII logged (emails never appear in logs)
 */

"use server";

import { z }                      from "zod";
import { eq }                     from "drizzle-orm";
import { redirect }               from "next/navigation";
import { getAuthUser }            from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { waitlistRepository }     from "@/repositories";
import { db }                     from "@/db";
import { sendInviteEmail, isEmailConfigured } from "@/lib/email";
import { waitlist }               from "@/db/schema";

// ─── inviteWaitlistEntryAction ────────────────────────────────────────────────

/**
 * inviteWaitlistEntryAction — Mark a waitlist entry as "invited".
 *
 * FormData fields:
 *   id: string — UUID of the waitlist entry to invite
 *
 * Sets the entry's status to "invited" so the user can claim it via /verify-access.
 * Owner must manually notify the user — no email is sent (email service not configured).
 *
 * Redirects back to /admin/waitlist after updating.
 */
export async function inviteWaitlistEntryAction(formData: FormData): Promise<never> {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  requireOwnerFromSession(auth);

  const id = formData.get("id");
  if (!id || typeof id !== "string") {
    redirect("/admin/waitlist?error=missing_id");
  }

  let emailed = false;
  try {
    const entry = await waitlistRepository.markLeadInvited(id);
    console.log(JSON.stringify({
      event:     "admin.waitlist.invited",
      entryId:   id,
      invitedBy: auth.replitUserId,
      ts:        new Date().toISOString(),
    }));
    // Auto-send the invite email when SMTP is configured; fall back silently
    // to the manual "Send invite email" button when it isn't (or on failure).
    if (isEmailConfigured()) {
      emailed = await sendInviteEmail(entry.email);
    }
  } catch (err) {
    console.error("[inviteWaitlistEntryAction] Failed to invite entry:", (err as Error).message);
    redirect("/admin/waitlist?error=invite_failed");
  }

  redirect(emailed ? "/admin/waitlist?message=invited_emailed" : "/admin/waitlist?message=invited_manual");
}

// ─── directInviteByEmailAction ────────────────────────────────────────────────

/**
 * directInviteByEmailAction — Owner invites an email address directly.
 *
 * Unlike inviteWaitlistEntryAction (which promotes an existing waitlist row),
 * this creates the row if needed and marks it "invited" in one step — so the
 * owner can invite anyone from /admin/waitlist without waiting for them to
 * request access first.
 *
 * FormData fields:
 *   email: string — the address to invite
 *
 * Behavior:
 *   - New email                    → insert with status "invited", source "owner_direct"
 *   - Existing entry (any status
 *     except active/converted)     → status set to "invited"
 *   - Already active/converted     → no-op (?error=already_active)
 *
 * No email is sent automatically (email service not configured). The page
 * shows a pre-written invite the owner can send with one click via their
 * own mail client.
 */
export async function directInviteByEmailAction(formData: FormData): Promise<never> {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  await requireOwnerFromSession(auth);

  const raw = formData.get("email");
  const parsed = z
    .string()
    .email()
    .max(320)
    .transform((v) => v.toLowerCase().trim())
    .safeParse(raw);
  if (!parsed.success) {
    redirect("/admin/waitlist?error=invalid_email");
  }
  const email = parsed.data;

  try {
    const [existing] = await db
      .select({ id: waitlist.id, status: waitlist.status })
      .from(waitlist)
      .where(eq(waitlist.email, email))
      .limit(1);

    if (existing) {
      if (existing.status === "active" || existing.status === "converted") {
        redirect("/admin/waitlist?error=already_active");
      }
      await waitlistRepository.markLeadInvited(existing.id);
    } else {
      await db.insert(waitlist).values({
        email,
        source: "owner_direct",
        status: "invited",
      });
    }

    // Auto-send when SMTP is configured (Google Workspace App Password);
    // otherwise the owner uses the "Send invite email" mailto button.
    if (isEmailConfigured() && (await sendInviteEmail(email))) {
      redirect("/admin/waitlist?message=invited_emailed");
    }

    console.log(JSON.stringify({
      event:     "admin.waitlist.direct_invited",
      invitedBy: auth.replitUserId,
      ts:        new Date().toISOString(),
      // email intentionally not logged (PII)
    }));
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("NEXT_REDIRECT")) throw err;
    console.error("[directInviteByEmailAction] failed:", msg);
    redirect("/admin/waitlist?error=invite_failed");
  }

  redirect("/admin/waitlist?message=direct_invited");
}

// ─── deleteWaitlistEntryAction ────────────────────────────────────────────────

/**
 * deleteWaitlistEntryAction — Owner removes a waitlist entry entirely.
 *
 * FormData fields:
 *   id: string — UUID of the waitlist entry to delete
 *
 * Deleting an invited-but-unclaimed entry revokes the invite. Existing user
 * accounts are untouched — manage those from /admin/users.
 */
export async function deleteWaitlistEntryAction(formData: FormData): Promise<never> {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  requireOwnerFromSession(auth);

  const id = formData.get("id");
  if (!id || typeof id !== "string") {
    redirect("/admin/waitlist?error=missing_id");
  }

  try {
    await waitlistRepository.deleteEntry(id);
    console.log(JSON.stringify({
      event:     "admin.waitlist.deleted",
      entryId:   id,
      deletedBy: auth.replitUserId,
      ts:        new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[deleteWaitlistEntryAction] failed:", (err as Error).message);
    redirect("/admin/waitlist?error=delete_failed");
  }

  redirect("/admin/waitlist?message=deleted");
}
