/**
 * providers/owner-guard.ts — Owner role authorization guard
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T7 — Owner role protection)
 *
 * Dependencies: @/providers/auth (session management)
 *
 * HUMAN REVIEW NOTES:
 * The owner guard is the authorization layer for all PodLever operations.
 *
 * Phase 1A authorization model:
 *   - PodLever is a single-owner tool. Only users with role="owner" in the DB
 *     can create, modify, or transition episodes.
 *   - The role is embedded in the iron-session cookie at login time.
 *   - The guard validates: (1) user is authenticated, (2) role is "owner".
 *   - No DB query per guard call — role is session-cached. Changing role in DB
 *     takes effect on the user's next login.
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

import { getAuthUser } from "@/providers/auth";

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
};

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * UnauthorizedError — thrown when there is no authenticated session.
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

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * requireOwner — Assert the calling user is authenticated and has the owner role.
 *
 * Must be called at the entry point (Server Action or Route Handler) — not inside
 * a service or repository. Services receive the userId from the entry point.
 *
 * @returns OwnerIdentity — the authenticated owner's DB user ID and display name
 * @throws UnauthorizedError — no session (not logged in)
 * @throws ForbiddenError — logged in but role is not "owner"
 *
 * Business context: PodLever is a single-owner internal tool (Phase 1A).
 * Every mutation goes through a Server Action that calls requireOwner() first.
 * The repository layer is the second defense (owner-scoped queries).
 */
export async function requireOwner(): Promise<OwnerIdentity> {
  const user = await getAuthUser();

  if (!user) {
    // No session — not authenticated
    throw new UnauthorizedError();
  }

  if (user.role !== "owner") {
    // Session exists but user is not an owner
    throw new ForbiddenError(user.role);
  }

  return {
    userId:       user.userId,
    replitUserId: user.replitUserId,
    displayName:  user.displayName,
  };
}

/**
 * getOwnerOrNull — Non-throwing version of requireOwner.
 *
 * Returns the owner identity if authenticated and is an owner, or null otherwise.
 * Useful for UI components that render conditionally based on auth state without
 * triggering a redirect.
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
