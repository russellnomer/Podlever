/**
 * app/verify-access/page.tsx — Beta invite self-declaration page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-24 by agent (error/success feedback + request-access form)
 *
 * Route: /verify-access
 *
 * Shown to authenticated non-owner users who are NOT yet linked to a waitlist entry.
 *
 * Two paths:
 *   1. "Claim my invite" — user enters the email they used on the waitlist.
 *      If a matching "invited" entry is found, their account is linked → /onboarding.
 *   2. "Request access" — user submits their email to join the queue.
 *      Owner sees this in /admin/waitlist and can promote to "invited".
 *
 * Query params:
 *   ?error=not_invited        — email not on invite list
 *   ?error=already_claimed    — invite taken by another account
 *   ?error=already_requested  — email already in queue
 *   ?error=invalid_email      — validation failure
 *   ?error=lookup_failed      — DB error during lookup
 *   ?error=link_failed        — DB error during linking
 *   ?message=request_sent     — access request recorded successfully
 *
 * Security:
 *   - All form submissions go to Server Actions with server-side validation
 *   - No PII in logs; emails are never logged
 */

import Link                      from "next/link";
import { claimBetaInviteAction, requestAccessAction } from "@/app/actions/beta.actions";
import { KeyRound, CheckCircle, AlertCircle, Info } from "lucide-react";

// ─── Error/success message maps ───────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  not_invited:
    "That email isn't on our invite list yet. Drop it in \"Request access\" below — we'll reach out when it's your turn.",
  already_claimed:
    "That invite has already been claimed by a different Replit account. Contact us if you think this is a mistake.",
  already_requested:
    "We already have your email — you're in the queue. We'll reach out when it's your turn.",
  already_invited_claim:
    "That email is on our invite list! Use the \"Claim my invite\" form above to link your account.",
  invalid_email:
    "Please enter a valid email address.",
  lookup_failed:
    "Something went wrong on our end. Please try again in a moment.",
  link_failed:
    "Something went wrong linking your account. Please try again or contact us.",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function VerifyAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  const errorMsg = error
    ? (ERROR_MESSAGES[error] ?? "Something went wrong. Please try again.")
    : null;

  const successMsg =
    message === "request_sent"
      ? "Request received — we'll email you when it's your turn."
      : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo / brand */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 text-center">
            You&apos;re almost in
          </h1>
          <p className="text-sm text-gray-500 text-center">
            PodLever is in private beta. Enter the email you used to join the
            waitlist — we&apos;ll link your account instantly.
          </p>
        </div>

        {/* Global feedback banner */}
        {errorMsg && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* ── Claim invite form ──────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Claim my invite
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Already been invited? Enter the email we sent your invite to.
            </p>
          </div>

          <form action={claimBetaInviteAction} className="space-y-3">
            <div>
              <label
                htmlFor="claim-email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Waitlist email
              </label>
              <input
                id="claim-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm
                           placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none
                           focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold
                         text-white shadow-sm hover:bg-indigo-700 transition-colors
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Claim invite →
            </button>
          </form>
        </div>

        {/* ── Request access form ────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Request access
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Not on the list yet? Submit your email and we&apos;ll add you to
              the queue.
            </p>
          </div>

          <form action={requestAccessAction} className="space-y-3">
            <div>
              <label
                htmlFor="request-email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Your email
              </label>
              <input
                id="request-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm
                           placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none
                           focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5
                         text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-100
                         transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Request access
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-start gap-2 text-xs text-gray-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Wrong account?{" "}
            <Link href="/auth/logout" className="underline hover:text-gray-600">
              Sign out
            </Link>{" "}
            and try with a different Replit account, or{" "}
            <Link href="/" className="underline hover:text-gray-600">
              return to home
            </Link>
            .
          </span>
        </div>
      </div>
    </div>
  );
}
