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

import { redirect }               from "next/navigation";
import { getAuthUser }            from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { waitlistRepository }     from "@/repositories";

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

  try {
    await waitlistRepository.markLeadInvited(id);
    console.log(JSON.stringify({
      event:     "admin.waitlist.invited",
      entryId:   id,
      invitedBy: auth.replitUserId,
      ts:        new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[inviteWaitlistEntryAction] Failed to invite entry:", (err as Error).message);
    redirect("/admin/waitlist?error=invite_failed");
  }

  redirect("/admin/waitlist");
}
