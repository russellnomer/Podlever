/**
 * app/admin/users/page.tsx — Owner demo/beta user console
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (admin demo-user console)
 *
 * Route: /admin/users (owner-only)
 *
 * One row per non-owner user showing:
 *   - usage this month vs their effective cap (override or tier default)
 *   - lifetime episodes and total pipeline cost (COGS) in USD
 *   - deal registration info from the linked waitlist entry (email + notes)
 *   - access controls: suspend/reinstate, per-user cap override, access expiry
 *
 * Security: requireOwnerFromSession() — redirects non-owners.
 * All mutations go through owner-guarded server actions in
 * app/actions/admin-users.actions.ts.
 */

import { redirect }                from "next/navigation";
import Link                        from "next/link";
import { getAuthUser }             from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { adminUsersRepository }    from "@/repositories";
import {
  suspendUserAction,
  reinstateUserAction,
  setCapOverrideAction,
  setAccessExpiryAction,
} from "@/app/actions/admin-users.actions";
import {
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  Users,
  DollarSign,
  Activity,
} from "lucide-react";

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  return `$${v.toFixed(v >= 10 ? 2 : 4)}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  await requireOwnerFromSession(auth);

  const params = await searchParams;
  const rows   = await adminUsersRepository.listUserOverview();

  const suspendedCount = rows.filter((r) => r.suspendedAt != null).length;
  const totalCost      = rows.reduce((s, r) => s + r.totalCostUsd, 0);
  const activeCount    = rows.length - suspendedCount;

  const flash: Record<string, string> = {
    suspended:      "User suspended — they can no longer process episodes.",
    reinstated:     "User reinstated.",
    cap_updated:    "Episode cap updated.",
    expiry_updated: "Access expiry updated.",
  };
  const errors: Record<string, string> = {
    missing_id:       "Missing user ID.",
    invalid_cap:      "Cap must be a whole number between 0 and 500.",
    invalid_date:     "Invalid expiry date.",
    suspend_failed:   "Suspension failed — check server logs.",
    reinstate_failed: "Reinstate failed — check server logs.",
    cap_failed:       "Cap update failed — check server logs.",
    expiry_failed:    "Expiry update failed — check server logs.",
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">

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
              <h1 className="text-xl font-bold text-gray-900">Demo &amp; Beta Users</h1>
              <p className="text-sm text-gray-500">
                Usage, cost, and access control for every non-owner account
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/admin/waitlist" className="text-indigo-600 hover:underline">
              Waitlist →
            </Link>
            <Link href="/admin/cogs" className="text-indigo-600 hover:underline">
              COGS →
            </Link>
          </div>
        </div>

        {/* Flash messages */}
        {params.message && flash[params.message] && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {flash[params.message]}
          </div>
        )}
        {params.error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errors[params.error] ?? "Something went wrong."}
          </div>
        )}

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-green-600">
              <Users className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Active users</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
            <p className="mt-1 text-xs text-gray-500">non-owner accounts with access</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Suspended</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{suspendedCount}</p>
            <p className="mt-1 text-xs text-gray-500">access revoked by you</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-indigo-600">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Total user cost</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{fmtUsd(totalCost)}</p>
            <p className="mt-1 text-xs text-gray-500">lifetime pipeline COGS, all users</p>
          </div>
        </div>

        {/* User cards */}
        {rows.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
            <Users className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">No demo or beta users yet.</p>
            <p className="mt-1 text-xs text-gray-400">
              Invite someone from the{" "}
              <Link href="/admin/waitlist" className="text-indigo-600 hover:underline">
                waitlist
              </Link>{" "}
              — they&apos;ll appear here after their first login.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((u) => {
              const isSuspended = u.suspendedAt != null;
              const overCap     = u.usedThisMonth >= u.effectiveLimit;
              return (
                <div
                  key={u.userId}
                  className={`rounded-xl border bg-white p-4 shadow-sm ${
                    isSuspended ? "border-red-300 bg-red-50/50" : "border-gray-200"
                  }`}
                >
                  {/* Row 1: identity + status + usage + cost */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">
                          {u.displayName ?? "(no display name)"}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            isSuspended
                              ? "bg-red-100 text-red-800"
                              : u.accessExpired
                                ? "bg-amber-100 text-amber-800"
                                : "bg-green-100 text-green-800"
                          }`}
                        >
                          {isSuspended
                            ? "Suspended"
                            : u.accessExpired
                              ? "Access expired"
                              : u.tierLabel}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {u.email ?? "no linked email"} · joined {fmtDate(u.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className={`font-bold ${overCap ? "text-red-600" : "text-gray-900"}`}>
                          {u.usedThisMonth} / {u.effectiveLimit}
                        </p>
                        <p className="text-xs text-gray-500">this month</p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-gray-900">{u.lifetimeEpisodes}</p>
                        <p className="text-xs text-gray-500">lifetime</p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-gray-900">{fmtUsd(u.totalCostUsd)}</p>
                        <p className="text-xs text-gray-500">your cost</p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-gray-900">
                          {u.lastActivityAt ? fmtDate(u.lastActivityAt) : "never"}
                        </p>
                        <p className="text-xs text-gray-500">last episode</p>
                      </div>
                    </div>
                  </div>

                  {/* Deal notes */}
                  {u.dealNotes && (
                    <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <span className="font-medium text-gray-700">Deal notes:</span> {u.dealNotes}
                    </p>
                  )}
                  {isSuspended && u.suspendedReason && (
                    <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                      <span className="font-medium">Suspended {fmtDate(u.suspendedAt)}:</span>{" "}
                      {u.suspendedReason}
                    </p>
                  )}

                  {/* Row 2: controls */}
                  <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
                    {/* Cap override */}
                    <form action={setCapOverrideAction} className="flex items-end gap-2">
                      <input type="hidden" name="userId" value={u.userId} />
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500">
                          Monthly cap {u.episodeCapOverride != null ? "(override)" : "(tier default)"}
                        </span>
                        <input
                          type="number"
                          name="cap"
                          min={0}
                          max={500}
                          defaultValue={u.episodeCapOverride ?? ""}
                          placeholder={String(u.effectiveLimit)}
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Set cap
                      </button>
                    </form>

                    {/* Access expiry */}
                    <form action={setAccessExpiryAction} className="flex items-end gap-2">
                      <input type="hidden" name="userId" value={u.userId} />
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500">
                          Access expires {u.accessExpiresAt ? `(${fmtDate(u.accessExpiresAt)})` : "(never)"}
                        </span>
                        <input
                          type="date"
                          name="expiresAt"
                          defaultValue={u.accessExpiresAt ? fmtDate(u.accessExpiresAt) : ""}
                          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Set expiry
                      </button>
                    </form>

                    <div className="flex-1" />

                    {/* Suspend / Reinstate */}
                    {isSuspended ? (
                      <form action={reinstateUserAction}>
                        <input type="hidden" name="userId" value={u.userId} />
                        <button
                          type="submit"
                          className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Reinstate
                        </button>
                      </form>
                    ) : (
                      <form action={suspendUserAction} className="flex items-end gap-2">
                        <input type="hidden" name="userId" value={u.userId} />
                        <input
                          type="text"
                          name="reason"
                          placeholder="Reason (recommended)"
                          maxLength={500}
                          className="w-48 rounded-md border border-gray-300 px-2 py-1 text-sm"
                        />
                        <button
                          type="submit"
                          className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                        >
                          <ShieldAlert className="h-4 w-4" />
                          Suspend
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
          <div className="flex items-start gap-2">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <p>
              <strong className="text-gray-700">How enforcement works:</strong> suspended or
              expired users are blocked at the upload gate immediately (limit 0) — no new
              episodes can be processed, so no new cost can be incurred. Caps are hard limits
              checked in the database on every episode. Every processed episode is logged in
              the usage ledger and costed in{" "}
              <Link href="/admin/cogs" className="text-indigo-600 hover:underline">
                COGS
              </Link>{" "}
              — that ledger is your evidence trail if you ever need to bill for unauthorized use.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
