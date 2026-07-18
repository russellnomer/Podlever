/**
 * providers/auth-errors.ts — Typed auth error classes (no server-only guard)
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (Task #8 — extracted for testability)
 *
 * HUMAN REVIEW NOTES:
 * These classes are intentionally extracted from owner-guard.ts so they can be
 * imported by scripts (e.g. scripts/verify-auth.ts via tsx) without triggering
 * the `server-only` guard that lives in owner-guard.ts.
 *
 * owner-guard.ts re-exports both classes from here — all production call sites
 * continue to import from @/providers/owner-guard and are unaffected.
 *
 * No `import "server-only"` here — this file contains only error class definitions
 * with no server-side I/O, no DB access, and no Next.js APIs.
 */

/**
 * UnauthorizedError — thrown when there is no authenticated session,
 * or when the session's version no longer matches the DB (stolen/revoked).
 * HTTP equivalent: 401. The user must log in.
 */
export class UnauthorizedError extends Error {
  readonly kind = "UnauthorizedError" as const;
  readonly statusCode = 401;
  constructor() {
    super("Authentication required. Please sign in to continue.");
  }
}

/**
 * ForbiddenError — thrown when the authenticated user is not an owner.
 * HTTP equivalent: 403. The user is logged in but does not have the required role.
 */
export class ForbiddenError extends Error {
  readonly kind = "ForbiddenError" as const;
  readonly statusCode = 403;
  constructor(role: string) {
    super(
      `Access denied. Owner role required; your role is "${role}". ` +
        "Contact the workspace owner if you believe this is an error.",
    );
  }
}
