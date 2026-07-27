/**
 * app/actions/feedback-admin.actions.ts — Owner-only feedback triage actions
 *
 * Part of: PodLever
 * Created: 2026-07-27 by agent (founder request — feedback knowledge base)
 *
 * Turns the read-only Feedback Inbox into a problem→solution knowledge base:
 * the owner triages each item to a status and records how it was addressed,
 * including a link to the GitHub PR/issue that fixed it.
 *
 * Security: requireOwner() on every action — never callable by beta users.
 */

"use server";

import { revalidatePath } from "next/cache";
import { requireOwner }   from "@/providers/owner-guard";
import { db }             from "@/db";
import { feedback, FEEDBACK_STATUSES } from "@/db/schema/feedback";
import type { FeedbackStatus }         from "@/db/schema/feedback";
import { eq }             from "drizzle-orm";

/**
 * updateFeedbackAction — Set status / resolution note / GitHub link on one
 * feedback item. Form fields: feedbackId, status, resolutionNote, resolutionLink.
 */
export async function updateFeedbackAction(formData: FormData): Promise<void> {
  await requireOwner();

  const feedbackId     = String(formData.get("feedbackId") ?? "");
  const statusRaw      = String(formData.get("status") ?? "new");
  const resolutionNote = String(formData.get("resolutionNote") ?? "").trim() || null;
  const resolutionLink = String(formData.get("resolutionLink") ?? "").trim() || null;

  if (!feedbackId) throw new Error("feedbackId required");
  const status: FeedbackStatus = (FEEDBACK_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as FeedbackStatus)
    : "new";

  // Only allow http(s) links (GitHub PRs/issues/commits)
  if (resolutionLink && !/^https?:\/\//i.test(resolutionLink)) {
    throw new Error("Resolution link must be a full https:// URL");
  }

  const resolved = status === "addressed" || status === "wont_fix";

  await db
    .update(feedback)
    .set({
      status,
      resolutionNote,
      resolutionLink,
      resolvedAt: resolved ? new Date() : null,
    })
    .where(eq(feedback.id, feedbackId));

  console.log(JSON.stringify({
    event: "feedback.triaged", feedbackId, status,
    hasNote: !!resolutionNote, hasLink: !!resolutionLink,
  }));

  revalidatePath("/admin/feedback");
}
