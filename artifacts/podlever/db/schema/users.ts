/**
 * users.ts — Drizzle schema for the `users` table
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: drizzle-orm/pg-core (table definition), drizzle-zod (schema generation)
 *
 * HUMAN REVIEW NOTES:
 * The `role` column uses a pgEnum so the database enforces valid values.
 * Only "owner" exists in Phase 1A (single-user system).
 * Multi-user roles (editor, viewer, guest) are deferred to Phase 1B+.
 *
 * `external_identity_id` is the opaque ID from whichever auth provider is
 * confirmed at T3 (Replit user ID, Clerk user ID, etc.). Its format is
 * intentionally left as text to remain provider-agnostic.
 *
 * `external_identity_provider` records which auth mechanism issued the ID,
 * enabling future provider migrations without destructive schema changes.
 */

import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────

/**
 * userRoleEnum — Valid roles in PodLever.
 * "owner" — full access; single authorized user in Phase 1A.
 * "user"  — authenticated but not authorized (access denied by owner guard).
 * Additional roles (editor, viewer) added additively in Phase 1B+.
 */
export const userRoleEnum = pgEnum("user_role", ["owner", "user"]);

// ─── Table ───────────────────────────────────────────────────────────────────

/**
 * users — PodLever user accounts.
 *
 * One row per authenticated identity. Created on first authenticated interaction
 * via the non-render auth-sync path (Route Handler or Server Action — never RSC render).
 *
 * Index: external_identity_id is queried on every authenticated request; ensure
 * a unique index exists (enforced by uniqueIndex below).
 */
export const users = pgTable("users", {
  /** Surrogate primary key — used everywhere internally. */
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * Opaque user ID from the external identity provider.
   * Format depends on T3 auth decision: Replit user ID (numeric string),
   * Clerk user ID (user_xxx), etc.
   * Unique — one row per external identity.
   */
  externalIdentityId: text("external_identity_id").notNull().unique(),

  /**
   * Which auth provider issued the external_identity_id.
   * Enables future provider migration without schema changes.
   * Examples: "replit", "clerk", "replit_oidc"
   */
  externalIdentityProvider: text("external_identity_provider").notNull(),

  /**
   * Display name from the identity provider (denormalized for convenience).
   * Not a unique constraint — display names can change.
   */
  displayName: text("display_name"),

  /**
   * User's role in PodLever.
   * Enforced by pgEnum — invalid values rejected at the DB level.
   * Phase 1A: always "owner" (single-user system).
   */
  role: userRoleEnum("role").notNull().default("owner"),

  /**
   * Session version counter — incremented at logout and on explicit revocation.
   *
   * Every iron-session cookie embeds the session_version value at login time.
   * requireOwner() compares the cookie's embedded version against this column
   * on every privileged request. A mismatch means the cookie was issued before
   * the last logout or revocation event → UnauthorizedError thrown.
   *
   * Security invariant: incrementing this column instantly invalidates ALL active
   * session cookies for this user, even unexpired and cryptographically valid ones.
   * No need to wait for cookie maxAge to expire.
   *
   * Starts at 1. Incremented atomically via SQL `session_version + 1`.
   */
  sessionVersion: integer("session_version").notNull().default(1),

  /** Row creation timestamp. Set once; never updated. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /**
   * Last-updated timestamp. Updated on profile sync from auth provider.
   * Useful for detecting stale identity data.
   */
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── TypeScript types ─────────────────────────────────────────────────────────

/** User — a fully-hydrated user row as returned from the database. */
export type User = typeof users.$inferSelect;

/** NewUser — the shape required to insert a new user row. */
export type NewUser = typeof users.$inferInsert;
