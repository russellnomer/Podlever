/**
 * app/actions/feedback.actions.ts — In-app feedback submission server action
 *
 * Part of: PodLever
 * Created: 2026-07-21 by agent
 *
 * Server Action called by FeedbackWidget. Validates input, persists to the
 * feedback table, and emits a structured log for immediate production-log
 * visibility (no email dependency required for the alpha phase).
 *
 * Access: any authenticated active beta user or owner may submit.
 *
 * Error handling contract for the client:
 *   - Returns { ok: true } on success
 *   - Returns { ok: false; error: string } on validation or auth failure
 *   - Never throws — all errors are converted to the above shape
 */

"use server";

import { z }                  from "zod";
import { getAuthUser }        from "@/providers/auth";
import { requireBetaAccess }  from "@/providers/owner-guard";
import { db }                 from "@/db";
import { feedback }           from "@/db/schema";

// ─── Input schema ─────────────────────────────────────────────────────────────

/** Validates the payload sent by the FeedbackWidget client component. */
const FeedbackSchema = z.object({
  /** Full URL of the page where the widget was triggered */
  pageUrl: z.string().url("pageUrl must be a valid URL").max(2000),
  /** Free-text feedback body */
  message: z.string()
    .min(1, "Please describe what happened.")
    .max(2000, "Feedback must be 2000 characters or fewer."),
});

// ─── Action ───────────────────────────────────────────────────────────────────

/**
 * submitFeedbackAction — Persist a feedback submission from any authenticated
 * active beta user or owner.
 *
 * Steps:
 *   1. Authenticate and authorise via requireBetaAccess (owner OR active beta)
 *   2. Validate input with Zod
 *   3. INSERT into the feedback table
 *   4. Emit a structured production log for immediate visibility
 *
 * @param input — Raw payload from FeedbackWidget (validated here)
 * @returns { ok: true } on success, { ok: false; error: string } on failure
 */
export async function submitFeedbackAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await getAuthUser();
  let identity;
  try {
    identity = await requireBetaAccess(session);
  } catch {
    return { ok: false, error: "You must be signed in to submit feedback." };
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const parsed = FeedbackSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { pageUrl, message } = parsed.data;

  // ── Persist ───────────────────────────────────────────────────────────────
  await db.insert(feedback).values({
    userId:      identity.userId,
    displayName: identity.displayName,
    pageUrl,
    message,
  });

  // ── Structured log (production-log visibility without an email dependency) ─
  // PII-free: userId only; displayName intentionally omitted from logs.
  console.log(JSON.stringify({
    event:      "feedback.submitted",
    userId:     identity.userId,
    pageUrl,
    msgLength:  message.length,
    timestamp:  new Date().toISOString(),
  }));

  return { ok: true };
}
