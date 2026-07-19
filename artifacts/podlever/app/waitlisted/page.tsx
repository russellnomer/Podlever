/**
 * app/waitlisted/page.tsx — Holding page for waitlisted users not yet invited
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #55 — Beta invite & onboarding)
 *
 * Route: /waitlisted
 *
 * Public page shown to users who are on the waitlist but haven't been invited yet.
 * No auth required — safe to share the URL.
 */

import Link from "next/link";
import { Clock, Mail } from "lucide-react";

export default function WaitlistedPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          You&#39;re on the list
        </h1>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          Thanks for your interest in PodLever. We&#39;re rolling out beta access in waves.
          You&#39;ll hear from us as soon as a spot opens up.
        </p>

        {/* Email prompt */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3 text-left mb-8">
          <Mail className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            Keep an eye on the email address you signed up with — we&#39;ll send your invite there.
          </p>
        </div>

        <Link
          href="/"
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Back to PodLever
        </Link>
      </div>
    </div>
  );
}
