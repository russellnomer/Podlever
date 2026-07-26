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

  // ── Database migrations (runtime, not build time) ─────────────────────────
  // Replit Autoscale builds run in the workspace environment where
  // DATABASE_URL is the DEVELOPMENT database; the production URL only exists
  // at runtime. Running migrations here guarantees they hit the real prod DB
  // on every boot. Drift-proof + advisory-locked; never crashes the server.
  //
  // NOTE: the import MUST be wrapped in a literal NEXT_RUNTIME === "nodejs"
  // check — webpack inlines that constant per-bundle and dead-code-eliminates
  // the import from the Edge bundle (startup-migrations uses node:fs/pg,
  // which cannot compile for Edge).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupMigrations } = await import("./lib/startup-migrations");
    await runStartupMigrations();
  }

  // ── OAuth callback URL check ──────────────────────────────────────────────
  // getCallbackUrl() uses OIDC_CALLBACK_URL (priority 1) or REPLIT_DOMAINS
  // (priority 2, runtime-injected by Replit Autoscale). At least one must
  // resolve to the correct production domain (podlever.com) or every login
  // attempt will return invalid_redirect_uri from Replit's OIDC provider.
  const hasExplicitUrl  = !!process.env.OIDC_CALLBACK_URL;
  const hasDomains      = !!process.env.REPLIT_DOMAINS;

  if (!hasExplicitUrl && !hasDomains) {
    console.error(
      "[startup] ⚠️  PRODUCTION MISCONFIGURATION: neither OIDC_CALLBACK_URL nor " +
        "REPLIT_DOMAINS is set.\n" +
        "           OAuth login will fail for all users on podlever.com.\n" +
        "           Fix: add OIDC_CALLBACK_URL=https://podlever.com/auth/callback\n" +
        "                to Replit Secrets (production environment scope).",
    );
  } else if (hasExplicitUrl) {
    // Explicit override is set — confirm it looks sane.
    if (!process.env.OIDC_CALLBACK_URL!.endsWith("/auth/callback")) {
      console.warn(
        "[startup] ⚠️  OIDC_CALLBACK_URL does not end with /auth/callback — " +
          `current value: ${process.env.OIDC_CALLBACK_URL}. ` +
          "Verify this matches the redirect_uri registered with Replit OIDC.",
      );
    } else {
      console.log(
        `[startup] OIDC callback URL (explicit): ${process.env.OIDC_CALLBACK_URL} ✓`,
      );
    }
  } else {
    // Falling back to REPLIT_DOMAINS — warn if podlever.com is not in the list.
    const domains = process.env.REPLIT_DOMAINS!.split(",").map((d) => d.trim());
    const hasProdDomain = domains.some(
      (d) => d === "podlever.com" || d === "www.podlever.com",
    );
    if (!hasProdDomain) {
      console.warn(
        "[startup] ⚠️  REPLIT_DOMAINS does not include podlever.com.\n" +
          `           Current value: ${process.env.REPLIT_DOMAINS}\n` +
          "           Login may fail on the custom domain. " +
          "Set OIDC_CALLBACK_URL=https://podlever.com/auth/callback to override.",
      );
    } else {
      console.log(
        `[startup] OIDC callback URL (REPLIT_DOMAINS): ${domains[0]}/auth/callback ✓`,
      );
    }
  }
}
