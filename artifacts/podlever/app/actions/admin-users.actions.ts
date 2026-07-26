/**
 * app/actions/admin-users.actions.ts — Owner-only user access-control actions
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (admin demo-user console — /admin/users)
 *
 * Server Actions for the /admin/users console:
 *
 *   suspendUserAction     — revoke a user's access immediately (with reason)
 *   reinstateUserAction   — clear a suspension (plan/caps untouched)
 *   setCapOverrideAction  — set/clear per-user monthly episode cap (deal registration)
 *   setAccessExpiryAction — set/clear a demo access expiry date
 *
 * Security:
 *   - Every action verifies role === "owner" via requireOwnerFromSession()
 *   - Targets are restricted to role='user' rows at the repository level —
 *     the owner account can never suspend/limit itself.
 *   - All actions are audit-logged as structured JSON (no PII beyond user UUID).
 */

"use server";

import { redirect }                from "next/navigation";
import { getAuthUser }             from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { adminUsersRepository }    from "@/repositories";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Assert owner and return their Replit user ID for audit logs. */
async function assertOwner(): Promise<string> {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  await requireOwnerFromSession(auth);
  return auth.replitUserId;
}

/** Read a required uuid-ish string field from FormData or bail to the console. */
function requireId(formData: FormData, field: string): string {
  const v = formData.get(field);
  if (!v || typeof v !== "string" || v.length > 64) {
    redirect("/admin/users?error=missing_id");
  }
  return v;
}

// ─── suspendUserAction ────────────────────────────────────────────────────────

/**
 * suspendUserAction — Immediately revoke a user's ability to process episodes.
 *
 * FormData fields:
 *   userId: string — DB UUID of the user to suspend
 *   reason: string — why (shown in the console; audit trail). Optional but encouraged.
 */
export async function suspendUserAction(formData: FormData): Promise<never> {
  const ownerReplitId = await assertOwner();
  const userId = requireId(formData, "userId");

  const rawReason = formData.get("reason");
  const reason =
    typeof rawReason === "string" && rawReason.trim().length > 0
      ? rawReason.trim().slice(0, 500)
      : "No reason recorded";

  try {
    await adminUsersRepository.suspendUser(userId, reason);
    console.log(JSON.stringify({
      event:       "admin.user.suspended",
      userId,
      suspendedBy: ownerReplitId,
      ts:          new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[suspendUserAction] failed:", (err as Error).message);
    redirect("/admin/users?error=suspend_failed");
  }

  redirect("/admin/users?message=suspended");
}

// ─── reinstateUserAction ──────────────────────────────────────────────────────

/**
 * reinstateUserAction — Clear a suspension. Plan and caps are untouched, so
 * the user returns to exactly the access they had before.
 *
 * FormData fields:
 *   userId: string — DB UUID of the user to reinstate
 */
export async function reinstateUserAction(formData: FormData): Promise<never> {
  const ownerReplitId = await assertOwner();
  const userId = requireId(formData, "userId");

  try {
    await adminUsersRepository.reinstateUser(userId);
    console.log(JSON.stringify({
      event:        "admin.user.reinstated",
      userId,
      reinstatedBy: ownerReplitId,
      ts:           new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[reinstateUserAction] failed:", (err as Error).message);
    redirect("/admin/users?error=reinstate_failed");
  }

  redirect("/admin/users?message=reinstated");
}

// ─── setCapOverrideAction ─────────────────────────────────────────────────────

/**
 * setCapOverrideAction — Set or clear a per-user monthly episode cap.
 *
 * FormData fields:
 *   userId: string — DB UUID of the user
 *   cap:    string — integer 0–500, or empty string to clear (use tier default)
 */
export async function setCapOverrideAction(formData: FormData): Promise<never> {
  const ownerReplitId = await assertOwner();
  const userId = requireId(formData, "userId");

  const rawCap = formData.get("cap");
  let cap: number | null = null;
  if (typeof rawCap === "string" && rawCap.trim() !== "") {
    const parsed = parseInt(rawCap.trim(), 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 500) {
      redirect("/admin/users?error=invalid_cap");
    }
    cap = parsed;
  }

  try {
    await adminUsersRepository.setEpisodeCapOverride(userId, cap);
    console.log(JSON.stringify({
      event:  "admin.user.cap_override_set",
      userId,
      cap,
      setBy:  ownerReplitId,
      ts:     new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[setCapOverrideAction] failed:", (err as Error).message);
    redirect("/admin/users?error=cap_failed");
  }

  redirect("/admin/users?message=cap_updated");
}

// ─── setAccessExpiryAction ────────────────────────────────────────────────────

/**
 * setAccessExpiryAction — Set or clear a demo access expiry date.
 * After this date the upload gate closes for the user (limit 0) until the
 * owner extends or clears it.
 *
 * FormData fields:
 *   userId:    string — DB UUID of the user
 *   expiresAt: string — YYYY-MM-DD (interpreted as end-of-day UTC), or empty to clear
 */
export async function setAccessExpiryAction(formData: FormData): Promise<never> {
  const ownerReplitId = await assertOwner();
  const userId = requireId(formData, "userId");

  const raw = formData.get("expiresAt");
  let expiresAt: Date | null = null;
  if (typeof raw === "string" && raw.trim() !== "") {
    // <input type="date"> submits YYYY-MM-DD. Interpret as 23:59:59 UTC that day
    // so "expires July 31" means the user has all of July 31.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (!m) redirect("/admin/users?error=invalid_date");
    const d = new Date(Date.UTC(+m![1]!, +m![2]! - 1, +m![3]!, 23, 59, 59));
    if (Number.isNaN(d.getTime())) redirect("/admin/users?error=invalid_date");
    expiresAt = d;
  }

  try {
    await adminUsersRepository.setAccessExpiry(userId, expiresAt);
    console.log(JSON.stringify({
      event:     "admin.user.access_expiry_set",
      userId,
      expiresAt: expiresAt?.toISOString() ?? null,
      setBy:     ownerReplitId,
      ts:        new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[setAccessExpiryAction] failed:", (err as Error).message);
    redirect("/admin/users?error=expiry_failed");
  }

  redirect("/admin/users?message=expiry_updated");
}
