/**
 * app/admin/feedback/page.tsx — Owner console: in-app feedback inbox
 *
 * Part of: PodLever
 * Created: 2026-07-26
 *
 * The FeedbackWidget has been writing submissions to the `feedback` table
 * since launch, but there was no page to READ them (the schema comment said
 * "future admin page"). Built the night the founder submitted feedback via
 * the widget and asked "Can you see the feedback?" — now everyone can.
 *
 * Route: /admin/feedback (owner-only)
 * Security: requireOwnerFromSession() — redirects non-owners.
 * Read-only: feedback rows are append-only; no mutations here.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { db } from "@/db";
import { feedback } from "@/db/schema/feedback";
import { desc } from "drizzle-orm";
import { ArrowLeft, MessageSquareText } from "lucide-react";

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

export default async function AdminFeedbackPage() {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  await requireOwnerFromSession(auth);

  const rows = await db
    .select()
    .from(feedback)
    .orderBy(desc(feedback.createdAt))
    .limit(200);

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
              Everything submitted through the in-app feedback widget, newest first
            </p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
            <MessageSquareText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">No feedback yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((f) => (
              <div key={f.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{f.displayName}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {pathOf(f.pageUrl)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{fmtWhen(f.createdAt)}</p>
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{f.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
