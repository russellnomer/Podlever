/**
 * instrumentation.ts — Next.js server instrumentation hook
 *
 * Part of: PodLever
 * Created: 2026-07-23
 *
 * Called once when the Next.js server starts (both dev and production).
 * Used to emit startup-time validation warnings that are visible in Cloud Run
 * logs immediately on boot — before any request is handled.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * IMPORTANT: Do NOT import from @/db, @/config, or any module that loads
 * environment config at module-evaluation time. This file must be side-effect-free
 * at import time; all work happens inside register().
 */

/**
 * register — invoked once by Next.js when the server initialises.
 *
 * Runs in the Node.js runtime only (not the Edge runtime).
 * Emits a clear error log if critical production configuration is missing,
 * so misconfiguration shows up in Cloud Run logs on first boot rather than
 * silently failing on the first login attempt.
 */
export async function register(): Promise<void> {
  // Only run the production checks in the Node.js runtime (not Edge).
  // process.env.NEXT_RUNTIME is "nodejs" or "edge"; absent in Node.js 18+ default.
  if (
    process.env.NEXT_RUNTIME === "edge" ||
    process.env.NODE_ENV !== "production"
  ) {
    return;
  }

  // ── OIDC_CALLBACK_URL check ──────────────────────────────────────────────
  // Without this, production login falls back to REPLIT_DOMAINS which does not
  // match the custom domain (podlever.com) registered with Replit's OIDC provider.
  // Result: every login attempt returns invalid_grant from the token endpoint.
  if (!process.env.OIDC_CALLBACK_URL) {
    console.error(
      "[startup] ⚠️  PRODUCTION MISCONFIGURATION: OIDC_CALLBACK_URL is not set.\n" +
        "           OAuth login will fail if a custom domain is active.\n" +
        "           Fix: add OIDC_CALLBACK_URL=https://podlever.com/auth/callback\n" +
        "                to Replit Secrets (production environment scope).",
    );
  } else {
    // Confirm the value looks sane — wrong URL is a common copy-paste mistake.
    if (!process.env.OIDC_CALLBACK_URL.endsWith("/auth/callback")) {
      console.warn(
        "[startup] OIDC_CALLBACK_URL does not end with /auth/callback — " +
          `current value: ${process.env.OIDC_CALLBACK_URL}. ` +
          "Verify this matches the redirect_uri registered with Replit OIDC.",
      );
    } else {
      console.log(
        `[startup] OIDC callback URL: ${process.env.OIDC_CALLBACK_URL} ✓`,
      );
    }
  }
}
