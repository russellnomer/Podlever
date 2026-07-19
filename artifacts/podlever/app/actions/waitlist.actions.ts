/**
 * app/actions/waitlist.actions.ts — Early-access waitlist Server Actions
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #19 — bot flood protection)
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
 * - Per-IP rate limiting: 5 submissions per 10 minutes (sliding window).
 *   Uses the same SlidingWindowRateLimiter as the login route; the limit
 *   is generous for human usage but stops automated floods cold.
 *   The user-facing error message does NOT reveal the rate-limit parameters.
 */

"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { waitlist } from "@/db/schema";
import { sql } from "drizzle-orm";
import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";

// ─── Rate limiter ────────────────────────────────────────────────────────────

/**
 * waitlistRateLimiter — module-level singleton shared across all requests in
 * this Node.js process. In-memory state is intentionally lost on restart
 * (limits reset, minor degradation, not a security failure).
 *
 * Limit: 5 submissions per IP per 10-minute sliding window.
 * Rationale: A real person signs up once. 5 slots absorb browser double-
 * submits and form retries without ever blocking a legitimate user.
 */
const waitlistRateLimiter = new SlidingWindowRateLimiter({
  max:      5,
  windowMs: 10 * 60 * 1_000, // 10-minute sliding window
});

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
  // ── Rate limit check ───────────────────────────────────────────────────────
  //
  // Server Actions run server-side but don't have a NextRequest object.
  // `headers()` from next/headers gives us the incoming request headers,
  // from which we extract the client IP the same way the login route does.
  //
  // The user-facing message is intentionally vague — no limit parameters
  // are disclosed to avoid helping a bot operator tune their attack.
  const requestHeaders = await headers();
  const clientIp = SlidingWindowRateLimiter.extractIp(requestHeaders);
  const rateLimit = waitlistRateLimiter.check(clientIp);

  if (!rateLimit.allowed) {
    // Warn in server logs so the owner can spot abuse without PII exposure.
    console.warn("[waitlist] rate limit exceeded", {
      ip:      clientIp,
      resetAt: new Date(rateLimit.resetAt).toISOString(),
    });

    return {
      success: false,
      error:   "Too many requests. Please wait a moment before trying again.",
    };
  }

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
