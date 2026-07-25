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
import { inviteWaitlistEntryAction } from "@/app/actions/admin.actions";
import { Users, ArrowLeft, Mail, CheckCircle, Clock, UserCheck } from "lucide-react";

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

export default async function AdminWaitlistPage() {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  requireOwnerFromSession(auth);

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

        {/* Email config notice */}
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Email notifications are not configured.</strong> When you invite someone,
          you must manually email them at podlever.com/auth/login and tell them to log in
          with Replit and enter their email on the verify-access page.
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
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
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
