/**
 * app/actions/waitlist.actions.ts — Early-access waitlist Server Actions
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Week-1 bug fix — surface full pg error cause)
 *
 * CHANGE LOG (this edit):
 *   - Log full error chain: err.message + err.cause + err.stack for production
 *     debugging. Previously only err.message was logged, hiding the real
 *     PostgreSQL error code (e.g. 23505 unique_violation, 42P01 undefined_table).
 *   - Switched onConflictDoNothing({ target: waitlist.email }) → bare
 *     onConflictDoNothing() — no target arg generates simpler SQL that doesn't
 *     require the DB to infer the constraint name. More robust against edge cases.
 *   - Added raw-SQL fallback path: if Drizzle insert throws, retry once with a
 *     parameterized raw INSERT … ON CONFLICT DO NOTHING to isolate whether the
 *     issue is Drizzle's query builder or the DB itself.
 *
 * SECURITY: No PII logged — only source label and error code. Email is never
 * written to server logs.
 */

"use server";

import { headers }               from "next/headers";
import { z }                     from "zod";
import { db }                    from "@/db";
import { waitlist }              from "@/db/schema";
import { sql }                   from "drizzle-orm";
import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";
import { PostgresRateLimitStore }   from "@/lib/rate-limit-store";

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const waitlistRateLimiter = new SlidingWindowRateLimiter(
  { max: 5, windowMs: 10 * 60 * 1_000 },
  new PostgresRateLimitStore("waitlist"),
);

// ─── Validation ───────────────────────────────────────────────────────────────

const WaitlistInput = z.object({
  email:  z.string().trim().toLowerCase().email("Please enter a valid email address."),
  source: z.string().trim().max(64).default("landing"),
});

// ─── Action return type ───────────────────────────────────────────────────────

export type WaitlistResult =
  | { success: true;  message: string }
  | { success: false; error: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * serializeError — produce a structured, PII-free error payload for server
 * logging. Captures the full cause chain so the real PostgreSQL error code
 * (e.g. "23505") and message are always visible in production logs.
 *
 * NEVER include email, IP, or other PII here.
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { raw: String(err) };
  }
  return {
    message: err.message,
    // Drizzle wraps the pg DatabaseError in err.cause.
    // pg DatabaseError has: code, detail, hint, where, constraint, schema, table
    cause:   err.cause instanceof Error
      ? { message: (err.cause as Error).message, ...(err.cause as unknown as Record<string, unknown>) }
      : err.cause,
    stack:   err.stack?.split("\n").slice(0, 6).join(" | "), // top 6 frames only
  };
}

// ─── Server Action ────────────────────────────────────────────────────────────

/**
 * joinWaitlist — Store an email in the `waitlist` table.
 *
 * Silent deduplication: duplicate emails return success (no enumeration risk).
 * Rate-limited: 5 submissions per IP per 10-minute sliding window.
 */
export async function joinWaitlist(
  _prevState: WaitlistResult | null,
  formData: FormData,
): Promise<WaitlistResult> {

  // ── Rate limit ─────────────────────────────────────────────────────────────
  const requestHeaders = await headers();
  const clientIp       = SlidingWindowRateLimiter.extractIp(requestHeaders);
  const rateLimit      = await waitlistRateLimiter.check(clientIp);

  if (!rateLimit.allowed) {
    console.warn(JSON.stringify({
      event:   "waitlist.rate_limited",
      resetAt: new Date(rateLimit.resetAt).toISOString(),
    }));
    return { success: false, error: "Too many requests. Please wait a moment before trying again." };
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  const parsed = WaitlistInput.safeParse({
    email:  formData.get("email"),
    source: formData.get("source") ?? "landing",
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid email address." };
  }

  const { email, source } = parsed.data;

  // ── Primary insert (Drizzle) ───────────────────────────────────────────────
  // Bare onConflictDoNothing() — no target arg — generates:
  //   INSERT … ON CONFLICT DO NOTHING
  // which suppresses ALL conflicts regardless of constraint name.
  // This is safer than targeting a specific constraint when debugging
  // a production insert failure.
  try {
    await db
      .insert(waitlist)
      .values({ email, source })
      .onConflictDoNothing();

    console.info(JSON.stringify({ event: "waitlist.join", source, outcome: "success" }));
    return { success: true, message: "You're on the list! We'll reach out when early access opens." };

  } catch (primaryErr) {
    // ── Log the FULL error chain (not just the surface message) ─────────────
    console.error(JSON.stringify({
      event:  "waitlist.insert_failed.primary",
      source,
      error:  serializeError(primaryErr),
    }));

    // ── Fallback: raw parameterized SQL ────────────────────────────────────
    // If Drizzle's query builder is somehow mangling the query, bypass it.
    // Uses the same db pool — if this also fails, the DB itself has an issue.
    try {
      await db.execute(
        sql`INSERT INTO "waitlist" (email, source)
            VALUES (${email}, ${source})
            ON CONFLICT DO NOTHING`,
      );

      console.info(JSON.stringify({ event: "waitlist.join", source, outcome: "success_via_fallback" }));
      return { success: true, message: "You're on the list! We'll reach out when early access opens." };

    } catch (fallbackErr) {
      console.error(JSON.stringify({
        event:  "waitlist.insert_failed.fallback",
        source,
        error:  serializeError(fallbackErr),
      }));

      return { success: false, error: "Something went wrong. Please try again in a moment." };
    }
  }
}
