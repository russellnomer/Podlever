/**
 * types/user.ts — Zod schemas and inferred TypeScript types for User domain
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: zod
 *
 * HUMAN REVIEW NOTES:
 * The Identity type is the narrow view of "who is this caller" as seen by
 * the AuthProvider interface. It is deliberately decoupled from the User DB
 * row — the AuthProvider produces an Identity, and the auth-sync path upserts
 * it into the users table. Downstream code works with Identity for auth checks
 * and User for domain queries.
 */

import { z } from "zod";

// ─── Identity (from AuthProvider — no DB dependency) ─────────────────────────

/**
 * IdentitySchema — the shape of an authenticated caller as returned by
 * AuthProvider.getCurrentIdentity(). Provider-agnostic.
 *
 * Populated from whichever mechanism T3 confirms (Replit headers, Clerk session, etc.).
 */
export const IdentitySchema = z.object({
  /** Opaque external ID from the auth provider (Replit user ID, Clerk user ID, etc.). */
  externalId: z.string().min(1),

  /** Which provider issued this identity (for audit and future migration). */
  provider: z.enum(["replit", "clerk", "replit_oidc", "stub"]),

  /** Display name from the provider. Optional — not all providers surface this at auth time. */
  displayName: z.string().optional(),
});

/** Identity — the narrow view of a caller returned by AuthProvider. */
export type Identity = z.infer<typeof IdentitySchema>;

// ─── Role ─────────────────────────────────────────────────────────────────────

/** UserRoleSchema — valid role strings (mirrors pgEnum in /db/schema/users.ts). */
export const UserRoleSchema = z.enum(["owner"]);

/** UserRole — valid role type. */
export type UserRole = z.infer<typeof UserRoleSchema>;

// ─── Upsert input ─────────────────────────────────────────────────────────────

/**
 * UpsertUserSchema — input for the auth-sync upsert path.
 * Called from Route Handler auth callback or first-interaction Server Action.
 * NEVER called during RSC render.
 */
export const UpsertUserSchema = z.object({
  externalIdentityId:       z.string().min(1),
  externalIdentityProvider: z.string().min(1),
  displayName:              z.string().optional(),
  role:                     UserRoleSchema.default("owner"),
});

/** UpsertUserInput — validated upsert input type. */
export type UpsertUserInput = z.infer<typeof UpsertUserSchema>;
