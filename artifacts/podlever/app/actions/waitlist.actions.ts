/**
 * app/actions/waitlist.actions.ts — Early-access waitlist Server Actions
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — Landing page + waitlist)
 *
 * Server Actions for the public waitlist capture form on the landing and
 * pricing pages. Phase 1: stores email in the `waitlist` DB table only.
 * Phase 2 (Stripe task): marks entries as converted on subscription.
 *
 * HUMAN REVIEW NOTES:
 * - Inputs are validated with Zod before any DB write.
 * - Email is lowercased at insert; duplicate emails use ON CONFLICT DO NOTHING
 *   (silent deduplication — the user sees "success" either way).
 * - No PII logged: only the source label and outcome are logged.
 * - Rate limiting is NOT applied here — this is a low-frequency marketing
 *   action. If abuse is observed, add IP-based throttling in Phase 2.
 */

"use server";

import { z } from "zod";
import { db } from "@/db";
import { waitlist } from "@/db/schema";
import { sql } from "drizzle-orm";

// ─── Validation schema ────────────────────────────────────────────────────────

/**
 * WaitlistInput — Zod schema for the join-waitlist form submission.
 * Email is trimmed and lowercased before storage.
 */
const WaitlistInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address."),
  source: z
    .string()
    .trim()
    .max(64)
    .default("landing"),
});

// ─── Action return type ───────────────────────────────────────────────────────

export type WaitlistResult =
  | { success: true; message: string }
  | { success: false; error: string };

// ─── Server Action ────────────────────────────────────────────────────────────

/**
 * joinWaitlist — Stores an email in the `waitlist` table.
 *
 * Uses ON CONFLICT DO NOTHING so duplicate emails are silently deduplicated.
 * The caller always receives a success response to avoid leaking whether an
 * email is already registered.
 *
 * @param formData - FormData from the waitlist form (email, source)
 * @returns WaitlistResult — success or validation/DB error
 */
export async function joinWaitlist(
  _prevState: WaitlistResult | null,
  formData: FormData,
): Promise<WaitlistResult> {
  // ── Validate inputs ────────────────────────────────────────────────────────
  const parsed = WaitlistInput.safeParse({
    email:  formData.get("email"),
    source: formData.get("source") ?? "landing",
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.errors[0]?.message ?? "Invalid email address.",
    };
  }

  const { email, source } = parsed.data;

  // ── Persist to DB ──────────────────────────────────────────────────────────
  try {
    await db
      .insert(waitlist)
      .values({ email, source })
      // Silent deduplication: if the email already exists, do nothing.
      // The user sees "success" either way — no email enumeration.
      .onConflictDoNothing({ target: waitlist.email });

    console.info("[waitlist] join", { source, outcome: "success" });

    return {
      success: true,
      message: "You're on the list! We'll reach out when early access opens.",
    };
  } catch (err) {
    // Log server-side only — never expose raw DB errors to the client.
    console.error("[waitlist] insert failed:", (err as Error).message);
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }
}
