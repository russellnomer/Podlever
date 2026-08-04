/**
 * app/admin/feedback/page.tsx — Owner console: feedback inbox + knowledge base
 *
 * Part of: PodLever
 * Created: 2026-07-26
 * Last modified: 2026-07-27 by agent (founder requests — triage statuses with
 * GitHub links as a knowledge base, and submitter emails for customer identity)
 *
 * Each feedback item can be triaged (New / In progress / Addressed / Won't fix)
 * with a resolution note and a link to the GitHub PR/issue that solved it —
 * the inbox doubles as a searchable problem→solution record.
 *
 * Submitter emails are resolved via users.externalIdentityId → waitlist
 * (same join the /admin/users page uses) because Replit OIDC display names
 * like "user_19531679" don't identify customers.
 *
 * Route: /admin/feedback (owner-only)
 * Security: requireOwnerFromSession() — redirects non-owners.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { db } from "@/db";
import { feedback, FEEDBACK_STATUSES } from "@/db/schema/feedback";
import { users } from "@/db/schema/users";
import { waitlist } from "@/db/schema/waitlist";
import { desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, MessageSquareText, ExternalLink } from "lucide-react";
import { updateFeedbackAction } from "@/app/actions/feedback-admin.actions";

export const dynamic = "force-dynamic";

function fmtWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }) + " ET";
}

/** Strip origin so long URLs render as readable paths. */
function pathOf(url: string): string {
  try { return new URL(url).pathname || url; } catch { return url; }
}

const STATUS_STYLES: Record<string, string> = {
  new:         "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  addressed:   "bg-green-100 text-green-800",
  wont_fix:    "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  new:         "New",
  in_progress: "In progress",
  addressed:   "Addressed",
  wont_fix:    "Won't fix",
};

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  await requireOwnerFromSession(auth);

  const { filter } = await searchParams;
  const activeFilter = (FEEDBACK_STATUSES as readonly string[]).includes(filter ?? "")
    ? filter!
    : "";

  // Feedback + submitter email (users → waitlist by Replit user ID)
  const rows = await db
    .select({
      f:     feedback,
      email: waitlist.email,
    })
    .from(feedback)
    // Cast users.id (uuid) to text to match feedback.userId (text) — avoids
    // "operator does not exist: uuid = text" in production PostgreSQL.
    .leftJoin(users, sql`${users.id}::text = ${feedback.userId}`)
    .leftJoin(waitlist, eq(waitlist.replitUserId, users.externalIdentityId))
    .orderBy(desc(feedback.createdAt))
    .limit(200);

  const filtered = activeFilter ? rows.filter((r) => r.f.status === activeFilter) : rows;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.f.status] = (counts[r.f.status] ?? 0) + 1;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/admin"
            className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm hover:text-gray-900"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Feedback Inbox</h1>
            <p className="text-sm text-gray-500">
              Triage every submission; addressed items link to the GitHub fix — your knowledge base
            </p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Link
            href="/admin/feedback"
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activeFilter === "" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 border border-gray-200"
            }`}
          >
            All ({rows.length})
          </Link>
          {FEEDBACK_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/admin/feedback?filter=${s}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                activeFilter === s ? "bg-indigo-600 text-white" : "bg-white text-gray-600 border border-gray-200"
              }`}
            >
              {STATUS_LABELS[s]} ({counts[s] ?? 0})
            </Link>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
            <MessageSquareText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">
              {activeFilter ? `No ${STATUS_LABELS[activeFilter]?.toLowerCase()} feedback.` : "No feedback yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(({ f, email }) => (
              <div key={f.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900">{f.displayName}</p>
                    {email && (
                      <a href={`mailto:${email}`} className="text-xs text-indigo-600 hover:underline">
                        {email}
                      </a>
                    )}
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {pathOf(f.pageUrl)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[f.status] ?? STATUS_STYLES.new}`}>
                      {STATUS_LABELS[f.status] ?? f.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{fmtWhen(f.createdAt)}</p>
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{f.message}</p>

                {/* Resolution summary (when triaged) */}
                {(f.resolutionNote || f.resolutionLink) && (
                  <div className="mt-3 rounded-lg bg-green-50 border border-green-100 px-3 py-2">
                    {f.resolutionNote && (
                      <p className="text-xs text-green-900">{f.resolutionNote}</p>
                    )}
                    {f.resolutionLink && (
                      <a
                        href={f.resolutionLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {f.resolutionLink.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>
                )}

                {/* Triage form */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                    Triage / update
                  </summary>
                  <form action={updateFeedbackAction} className="mt-2 space-y-2">
                    <input type="hidden" name="feedbackId" value={f.id} />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        name="status"
                        defaultValue={f.status}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700"
                      >
                        {FEEDBACK_STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                      <input
                        type="url"
                        name="resolutionLink"
                        defaultValue={f.resolutionLink ?? ""}
                        placeholder="GitHub PR/issue link (https://github.com/…)"
                        className="min-w-64 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                    <textarea
                      name="resolutionNote"
                      defaultValue={f.resolutionNote ?? ""}
                      placeholder="How was this addressed? (e.g. Fixed job claim mapping — every queue job failed before this)"
                      rows={2}
                      className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      Save
                    </button>
                  </form>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
