/**
 * providers/owner-guard.ts — Owner role authorization guard
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (Task #8 — session version check)
 *
 * Dependencies:
 *   @/providers/auth  — session management
 *   @/db             — database client (session version lookup)
 *   @/db/schema      — users table
 *
 * HUMAN REVIEW NOTES:
 * The owner guard is the authorization layer for all PodLever operations.
 *
 * Phase 1A authorization model:
 *   - PodLever is a single-owner tool. Only users with role="owner" in the DB
 *     can create, modify, or transition episodes.
 *   - The role is embedded in the iron-session cookie at login time.
 *   - The guard validates three gates in order:
 *       Gate 1: user is authenticated (session cookie is present and decrypts)
 *       Gate 2: user.role === "owner" (role embedded in cookie at login)
 *       Gate 3: cookie's sessionVersion matches users.session_version in DB
 *               (catches stolen cookies and forces re-login after logout)
 *   - Gate 3 requires one DB SELECT per privileged request. Acceptable cost for
 *     a single-owner internal tool. Phase 1B: add a short-lived cache if needed.
 *   - Role changes in the DB take effect on the user's next login (Gate 2 is
 *     cookie-cached). Gate 3 is NOT affected by role changes — only by logout.
 *
 * Session version security invariant:
 *   - At login:  users.session_version is read from DB and embedded in the cookie.
 *   - At logout: users.session_version is incremented atomically in the DB.
 *   - On every owner request: cookie version === DB version is asserted.
 *   - A stolen cookie is rejected the moment the legitimate user logs out.
 *   - A forged cookie (no knowledge of SESSION_SECRET) is rejected by iron-session
 *     decryption (Gate 1) before Gate 3 is ever reached.
 *
 * Usage pattern (Server Actions):
 *   ```typescript
 *   "use server";
 *   import { requireOwner } from "@/providers/owner-guard";
 *   import { episodeService } from "@/services";
 *
 *   export async function createEpisodeAction(input: unknown) {
 *     const { userId } = await requireOwner(); // throws if not owner
 *     return episodeService.createEpisode(input, userId);
 *   }
 *   ```
 *
 * Phase 1B+: If multi-role support is added (team member, viewer), extend
 * OwnerIdentity and add a requireRole(role) variant here.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAuthUser } from "@/providers/auth";
import type { PodLeverSession } from "@/providers/auth";
// Imported for use within this file and re-exported so all existing call sites
// (`import { UnauthorizedError } from "@/providers/owner-guard"`) continue to
// work without modification. Defined in auth-errors.ts (no server-only guard)
// so verify-auth.ts can import them directly via tsx.
import { UnauthorizedError, ForbiddenError } from "@/providers/auth-errors";
export { UnauthorizedError, ForbiddenError };

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * OwnerIdentity — the minimal caller identity returned by requireOwner().
 * Contains only what services need — the DB user ID.
 */
export type OwnerIdentity = {
  /** DB UUID from users.id — use this as ownerId in service calls */
  userId: string;
  /** Replit numeric user ID — available for audit logs */
  replitUserId: string;
  /** Display name — available for UI rendering without a DB query */
  displayName: string;
  /** Current billing plan slug ("free" | "pro" | "agency") — from users.plan */
  plan: string;
};

// ─── Guard (internal — testable without Next.js cookies() context) ────────────

/**
 * requireOwnerFromSession — Assert that the given session represents an
 * authenticated, authorized owner with a valid (non-revoked) session.
 *
 * This is the inner implementation of the guard. It accepts a pre-resolved
 * PodLeverSession | null so it can be called from:
 *   - requireOwner() (production path — reads session from Next.js cookies)
 *   - verify-auth.ts (test path — constructs session directly without Next.js)
 *
 * Three gates in order:
 *   Gate 1: user must be non-null (authenticated session cookie)
 *   Gate 2: user.role must be "owner"
 *   Gate 3: user.sessionVersion must match users.session_version in DB
 *           (rejects stolen cookies once the legitimate user has logged out)
 *
 * Gate 3 executes one DB SELECT per call. The SELECT is lightweight (primary key
 * lookup returning a single integer column). Acceptable for Phase 1A.
 *
 * @param user  Resolved session from getAuthUser(), or null if unauthenticated
 * @returns OwnerIdentity — authenticated owner's DB user ID and display name
 * @throws UnauthorizedError — no session, or session version mismatch (revoked)
 * @throws ForbiddenError   — logged in but role is not "owner"
 */
export async function requireOwnerFromSession(
  user: PodLeverSession | null,
): Promise<OwnerIdentity> {
  // Gate 1 — must be authenticated (cookie decrypted and userId present)
  if (!user) {
    throw new UnauthorizedError();
  }

  // Gate 2 — must have the owner role (cached in cookie at login time)
  if (user.role !== "owner") {
    throw new ForbiddenError(user.role);
  }

  // Gate 3 — session version must match the DB (catches stolen/revoked sessions)
  //
  // We fetch only the session_version column to minimize data transfer.
  // A missing row (user deleted from DB) is treated as UnauthorizedError.
  const [dbUser] = await db
    .select({ sessionVersion: users.sessionVersion, plan: users.plan })
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1);

  if (!dbUser || dbUser.sessionVersion !== user.sessionVersion) {
    // Log the version mismatch for SOC audit trail (no PII — only DB user ID)
    console.log(JSON.stringify({
      event:               "auth.session_version_mismatch",
      userId:              user.userId,
      cookieVersion:       user.sessionVersion,
      dbVersion:           dbUser?.sessionVersion ?? null,
      timestamp:           new Date().toISOString(),
    }));
    throw new UnauthorizedError();
  }

  return {
    userId:       user.userId,
    replitUserId: user.replitUserId,
    displayName:  user.displayName,
    plan:         dbUser.plan,
  };
}

// ─── Guard (public — Next.js Server Actions and Route Handlers) ───────────────

/**
 * requireOwner — Assert the calling user is authenticated, has the owner role,
 * and holds a non-revoked session (version matches DB).
 *
 * Must be called at the entry point (Server Action or Route Handler) — not inside
 * a service or repository. Services receive the userId from the entry point.
 *
 * @returns OwnerIdentity — the authenticated owner's DB user ID and display name
 * @throws UnauthorizedError — no session, or session version revoked by logout
 * @throws ForbiddenError — logged in but role is not "owner"
 *
 * Business context: PodLever is a single-owner internal tool (Phase 1A).
 * Every mutation goes through a Server Action that calls requireOwner() first.
 * The repository layer is the second defense (owner-scoped queries).
 */
export async function requireOwner(): Promise<OwnerIdentity> {
  const user = await getAuthUser();
  return requireOwnerFromSession(user);
}

/**
 * getOwnerOrNull — Non-throwing version of requireOwner.
 *
 * Returns the owner identity if authenticated, authorized, and session is valid,
 * or null otherwise. Useful for UI components that render conditionally based on
 * auth state without triggering a redirect.
 *
 * @returns OwnerIdentity or null
 */
export async function getOwnerOrNull(): Promise<OwnerIdentity | null> {
  try {
    return await requireOwner();
  } catch {
    return null;
  }
}

// ─── Beta access guard ─────────────────────────────────────────────────────────

/**
 * UserIdentity — caller identity returned by requireBetaAccess().
 *
 * Extends OwnerIdentity with an isOwner flag so callers can branch on role
 * (e.g. to show/hide admin-only UI or to scope repository calls).
 *
 * All other fields are identical to OwnerIdentity — services can accept
 * UserIdentity wherever they previously accepted OwnerIdentity.
 */
export type UserIdentity = OwnerIdentity & {
  /** true when the caller has role === "owner"; false for active beta users. */
  isOwner: boolean;
};

/**
 * requireBetaAccess — Assert that the given session may access the episode
 * pipeline: either an owner OR a user with betaAccess === "active".
 *
 * Applies the same three gates as requireOwnerFromSession:
 *   Gate 1: user must be authenticated (session cookie present and valid)
 *   Gate 2: user.role === "owner" OR user.betaAccess === "active"
 *   Gate 3: session version matches DB (rejects revoked/stolen sessions)
 *
 * Used by episode pages, actions, and route handlers so that active beta
 * testers can use the product while CRM and admin routes stay owner-only.
 *
 * Each user's episodes are always scoped to their own userId, so owners
 * and beta users never see each other's data.
 *
 * @param user  Pre-resolved session (from getAuthUser()) or null
 * @returns UserIdentity — the caller's DB ID, display name, plan, and role flag
 * @throws UnauthorizedError — no session, or session version revoked
 * @throws ForbiddenError   — logged in but neither owner nor active beta user
 */
export async function requireBetaAccess(
  user: PodLeverSession | null,
): Promise<UserIdentity> {
  // Gate 1 — must be authenticated
  if (!user) {
    throw new UnauthorizedError();
  }

  // Gate 2 — any authenticated user may use the product (2026-07-26 change:
  // self-serve free trial opened — plan-based limits are the entitlement layer,
  // enforced in the DB via UsageRepository). Beta claim is no longer required.
  const isOwner = user.role === "owner";

  // Gate 3 — session version must match the DB (catches stolen/revoked sessions)
  // and the account must not be suspended by the owner.
  //
  // Same one-row SELECT used by requireOwnerFromSession. Acceptable cost for
  // every privileged request.
  const [dbUser] = await db
    .select({
      sessionVersion: users.sessionVersion,
      plan:           users.plan,
      suspendedAt:    users.suspendedAt,
    })
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1);

  // Suspended accounts are hard-blocked from every product action (upload,
  // process, regenerate, export) — not just new episodes. Owner-set via /admin/users.
  if (!isOwner && dbUser?.suspendedAt != null) {
    throw new ForbiddenError("suspended");
  }

  if (!dbUser || dbUser.sessionVersion !== user.sessionVersion) {
    console.log(JSON.stringify({
      event:         "auth.session_version_mismatch",
      userId:        user.userId,
      cookieVersion: user.sessionVersion,
      dbVersion:     dbUser?.sessionVersion ?? null,
      timestamp:     new Date().toISOString(),
    }));
    throw new UnauthorizedError();
  }

  return {
    userId:       user.userId,
    replitUserId: user.replitUserId,
    displayName:  user.displayName,
    plan:         dbUser.plan,
    isOwner,
  };
}

/**
 * requireBetaUser — Cookie-reading variant of requireBetaAccess.
 *
 * Reads the session from Next.js cookies() then calls requireBetaAccess.
 * Use in Server Actions and Route Handlers where the session is not
 * already resolved (i.e. wherever requireOwner() was previously called
 * for episode operations).
 *
 * Do NOT use for CRM, admin, or export routes — those remain owner-only.
 *
 * @returns UserIdentity — authenticated user's identity
 * @throws UnauthorizedError, ForbiddenError
 */
export async function requireBetaUser(): Promise<UserIdentity> {
  const user = await getAuthUser();
  return requireBetaAccess(user);
}
