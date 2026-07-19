/**
 * app/verify-access/page.tsx — Beta invite self-declaration page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #55 — Beta invite & onboarding)
 *
 * Route: /verify-access
 *
 * Shown to authenticated non-owner users who are NOT yet linked to a waitlist entry.
 * The user enters the email address they used on the waitlist.
 * If a matching entry with status "invited" is found, their Replit account is linked
 * and they are redirected to /onboarding.
 *
 * Security:
 *   - Email is validated server-side
 *   - Only "invited" entries can be claimed (prevents claiming unconverted leads)
 *   - Each waitlist entry can only be claimed by one Replit account (unique constraint on replit_user_id)
 *   - No PII (email) logged
 */

import Link from "next/link";
import { claimBetaInviteAction } from "@/app/actions/beta.actions";
import { KeyRound } from "lucide-react";

export default function VerifyAccessPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          You&#39;re almost in
        </h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          Enter the email you used to join the waitlist. We&#39;ll link your account instantly.
        </p>

        {/* Form — uses Server Action */}
        <form action={claimBetaInviteAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Waitlist email
            </label>
            <input
              id="email"
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
            Claim my invite
          </button>
        </form>

        {/* Not on list */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Not on the waitlist?{" "}
          <Link href="/" className="text-indigo-600 hover:underline">
            Request access
          </Link>
        </p>
      </div>
    </div>
  );
}
