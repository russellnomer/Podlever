/**
 * app/admin/waitlist/page.tsx — Owner waitlist management
 *
 * Part of: PodLever
 * Created: 2026-07-24 by agent (Item 3 & 4 of verify-access fix)
 *
 * Route: /admin/waitlist (owner-only)
 *
 * Shows all waitlist entries grouped by status.
 * Owner can invite individual entries (status → "invited") with one click.
 * New "Request access" submissions appear here as status "new".
 *
 * Security: requireOwnerFromSession() — redirects non-owners.
 *
 * NOTE: email notification is NOT sent when inviting — the email service is
 * not configured in production. Owner must manually inform invitees.
 */

import { redirect }               from "next/navigation";
import Link                       from "next/link";
import { getAuthUser }            from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { waitlistRepository }     from "@/repositories";
import { LEAD_STATUSES }          from "@/db/schema";
import {
  inviteWaitlistEntryAction,
  directInviteByEmailAction,
  deleteWaitlistEntryAction,
} from "@/app/actions/admin.actions";
import { Users, ArrowLeft, Mail, CheckCircle, Clock, UserCheck, Send, UserPlus, Trash2 } from "lucide-react";

// ─── Invite email (professional copy, sent from the owner's mail client) ──────

/**
 * inviteMailtoHref — Build a mailto: link that opens the owner's mail client
 * with a fully written, professional invite email addressed to the invitee.
 * No email service is configured in production, so this one-click compose
 * is how invites actually get delivered.
 */
function inviteMailtoHref(email: string): string {
  const subject = "Your private beta invitation to PodLever";
  const body = `Hi,

I'd like to personally invite you to the private beta of PodLever.

PodLever turns a raw podcast recording into a complete, publish-ready content package — full transcript, polished show notes, a blog post, social media posts, and a shareable guest page — in minutes, not hours.

As a beta member you get complimentary Pro-level access (10 episodes per month) at no cost for the duration of the beta.

Getting started takes about two minutes:

  1. Go to https://podlever.com/auth/login
  2. Sign in with your Replit account (free to create if you don't have one)
  3. When prompted, enter this email address (${email}) to claim your invite
  4. Upload your first episode and watch the content package build itself

Beta access is limited and personal to you. Your feedback directly shapes the product — if anything is confusing or falls short, I want to hear about it.

Welcome aboard,

Russell Nomer
Founder, PodLever
https://podlever.com`;

  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ─── Status display config ────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string }> = {
  new:           { label: "New request",  color: "bg-yellow-100 text-yellow-800" },
  contacted:     { label: "Contacted",    color: "bg-blue-100 text-blue-800" },
  qualified:     { label: "Qualified",    color: "bg-purple-100 text-purple-800" },
  invited:       { label: "Invited",      color: "bg-indigo-100 text-indigo-800" },
  active:        { label: "Active",       color: "bg-green-100 text-green-800" },
  converted:     { label: "Converted",    color: "bg-emerald-100 text-emerald-800" },
  disqualified:  { label: "Disqualified", color: "bg-gray-100 text-gray-500" },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function AdminWaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  requireOwnerFromSession(auth);

  const params = await searchParams;
  const flashMessages: Record<string, string> = {
    direct_invited:
      "Invited! Now click “Send invite email” on their row below — it opens a pre-written email in your mail client.",
    invited_emailed:
      "Invited — the invitation email was sent automatically from invites@podlever.com. ✉️",
    invited_manual:
      "Invited! Auto-email isn't configured, so click “Send invite email” on their row to send it from your mail client.",
    deleted: "Waitlist entry removed.",
  };
  const flashErrors: Record<string, string> = {
    invalid_email:  "That doesn't look like a valid email address.",
    already_active: "That person already has an active account.",
    invite_failed:  "Invite failed — check server logs.",
    delete_failed:  "Delete failed — check server logs.",
    missing_id:     "Missing entry ID.",
  };

  // Fetch all entries + status counts in parallel
  const [{ entries, total }, statusCounts] = await Promise.all([
    waitlistRepository.list({ page: 1, pageSize: 100 }),
    waitlistRepository.getStatusCounts(),
  ]);

  const newCount      = statusCounts["new"]      ?? 0;
  const invitedCount  = statusCounts["invited"]   ?? 0;
  const activeCount   = statusCounts["active"]    ?? 0;

  // Entries eligible for one-click invite (not yet invited or active)
  const invitableStatuses = ["new", "contacted", "qualified"];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Waitlist</h1>
              <p className="text-sm text-gray-500">{total} total entries</p>
            </div>
          </div>
          <Link
            href="/admin/analytics"
            className="text-sm text-indigo-600 hover:underline"
          >
            Analytics →
          </Link>
        </div>

        {/* Status summary */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-yellow-600 mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">New requests</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{newCount}</p>
            <p className="text-xs text-gray-500 mt-1">awaiting your invite</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-indigo-600 mb-1">
              <Mail className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Invited</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{invitedCount}</p>
            <p className="text-xs text-gray-500 mt-1">invite sent, not yet active</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-green-600 mb-1">
              <UserCheck className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Active</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
            <p className="text-xs text-gray-500 mt-1">onboarded beta users</p>
          </div>
        </div>

        {/* Flash messages */}
        {params.message && flashMessages[params.message] && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {flashMessages[params.message]}
          </div>
        )}
        {params.error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {flashErrors[params.error] ?? "Something went wrong."}
          </div>
        )}

        {/* Invite by email */}
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
          <div className="mb-2 flex items-center gap-2 text-indigo-700">
            <UserPlus className="h-4 w-4" />
            <h2 className="text-sm font-semibold">Invite someone by email</h2>
          </div>
          <form action={directInviteByEmailAction} className="flex gap-2">
            <input
              type="email"
              name="email"
              required
              placeholder="name@example.com"
              className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white
                         hover:bg-indigo-700 transition-colors"
            >
              Invite
            </button>
          </form>
          <p className="mt-2 text-xs text-indigo-700/80">
            Adds them as invited instantly. Then click <strong>Send invite email</strong> on
            their row — it opens a professionally written invitation in your mail client,
            addressed and ready to send.
          </p>
        </div>

        {/* Entries table */}
        {entries.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
            <Users className="mx-auto h-10 w-10 text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No waitlist entries yet.</p>
            <p className="text-gray-400 text-xs mt-1">
              Users who submit via &quot;Request access&quot; on /verify-access will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Joined
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => {
                  const meta   = STATUS_META[entry.status] ?? STATUS_META["new"]!;
                  const linked = !!entry.replitUserId;
                  const canInvite = invitableStatuses.includes(entry.status);

                  return (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-800 max-w-[180px] truncate">
                        {entry.email}
                        {linked && (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-green-600">
                            <CheckCircle className="h-3 w-3" />
                            <span className="text-[10px]">linked</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {entry.source}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(entry.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day:   "numeric",
                          year:  "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canInvite ? (
                            <form action={inviteWaitlistEntryAction}>
                              <input type="hidden" name="id" value={entry.id} />
                              <button
                                type="submit"
                                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold
                                           text-white hover:bg-indigo-700 transition-colors"
                              >
                                Invite
                              </button>
                            </form>
                          ) : entry.status === "invited" ? (
                            <a
                              href={inviteMailtoHref(entry.email)}
                              className="inline-flex items-center gap-1 rounded-md border border-indigo-300
                                         bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700
                                         hover:bg-indigo-50 transition-colors"
                            >
                              <Send className="h-3 w-3" />
                              Send invite email
                            </a>
                          ) : null}
                          <form action={deleteWaitlistEntryAction}>
                            <input type="hidden" name="id" value={entry.id} />
                            <button
                              type="submit"
                              title="Remove from waitlist"
                              className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-400
                                         hover:border-red-300 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* CRM link */}
        <p className="mt-4 text-center text-xs text-gray-400">
          For detailed CRM management (notes, bulk actions, CSV export), visit the{" "}
          <Link href="/dashboard" className="underline hover:text-gray-600">
            dashboard CRM
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
