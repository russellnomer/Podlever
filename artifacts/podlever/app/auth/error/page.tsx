/**
 * app/auth/error/page.tsx — Visible sign-in failure page (breaks the loop)
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (login-loop diagnostics)
 *
 * Route: /auth/error?code=...&detail=...  (public — /auth is in AUTH_PATHS)
 *
 * Every failure branch in /auth/callback redirects here instead of bouncing
 * straight back to /auth/login. That silent bounce caused an infinite
 * consent loop at Replit with no visible explanation — the real reason only
 * existed in server logs. This page names the failure so the user (or the
 * owner via screenshot) can see exactly what went wrong, then retry
 * deliberately.
 */

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export const metadata = {
  title: "Sign-in problem — PodLever",
  robots: { index: false },
};

/** Human explanations per failure code emitted by /auth/callback. */
const EXPLANATIONS: Record<string, string> = {
  pkce_decrypt:
    "Your sign-in security cookie could not be read. This usually means it was created by an older version of the app, or a browser extension modified it.",
  pkce_missing:
    "Your browser did not send the sign-in security cookie back to us. Common causes: cookies are blocked for podlever.com, the sign-in took longer than 10 minutes, or you started on a different address (e.g. www.podlever.com).",
  token_exchange:
    "Replit did not accept the sign-in code. This can be a temporary Replit issue, a clock problem on the server, or a configuration mismatch.",
  db:
    "Signing you in worked, but saving your account to the database failed. This is a server-side problem — please report it.",
  session:
    "Signing you in worked, but your session cookie could not be created. This is a server-side problem — please report it.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; detail?: string }>;
}) {
  const { code = "unknown", detail = "" } = await searchParams;
  const explanation =
    EXPLANATIONS[code] ??
    "An unexpected problem occurred during sign-in.";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Sign-in hit a snag</h1>
        </div>

        <p className="text-sm text-gray-600 mb-4">{explanation}</p>

        {/* Diagnostic block — meant to be screenshotted when reporting */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 mb-6 font-mono text-xs text-gray-700 break-all">
          <div><span className="text-gray-400">code:</span> {code}</div>
          {detail && <div className="mt-1"><span className="text-gray-400">detail:</span> {detail}</div>}
          <div className="mt-1"><span className="text-gray-400">time:</span> {new Date().toISOString()}</div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/auth/login"
            className="inline-flex items-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm
                       font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
          >
            Try signing in again
          </a>
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Back to home
          </Link>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          If this keeps happening, screenshot this page and send it to the person
          who invited you — the code above tells us exactly what to fix.
        </p>
      </div>
    </div>
  );
}
