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
  boolean,
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

  /**
   * Current plan slug for this user.
   * Matches keys in lib/tiers.ts: "free" | "beta" | "pro" | "agency".
   * Default: "free" (upgraded by Stripe webhooks in Task #14).
   * Beta invitees are set to "beta" by activateBetaUserAction.
   * Text column (not pgEnum) so tier names can change without schema migration.
   */
  plan: text("plan").notNull().default("free"),

  /**
   * UTM attribution fields — set once on first authenticated visit.
   * Captured from the URL query string and stored here for funnel analysis.
   * All nullable: most users arrive without UTM params.
   * Never overwritten after initial set — preserves first-touch attribution.
   */
  utmSource:   text("utm_source"),
  utmMedium:   text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent:  text("utm_content"),

  /**
   * Stripe customer ID — set during first Stripe Checkout.
   * Used as the FK to look up subscriptions in the stripe schema.
   * Unique constraint: one customer per PodLever user account.
   */
  stripeCustomerId: text("stripe_customer_id").unique(),

  /** Active Stripe subscription ID. Null on free plan. */
  stripeSubscriptionId: text("stripe_subscription_id"),

  /**
   * UTC end of the current paid billing period.
   * Set by checkout.session.completed / customer.subscription.updated webhooks.
   * Null for free plan users.
   */
  planPeriodEnd: timestamp("plan_period_end", { withTimezone: true }),

  /**
   * Grace period end after a failed payment.
   * Set by invoice.payment_failed webhook; cleared on payment success.
   * Features remain active during grace period; restricted after expiry.
   */
  paymentGraceUntil: timestamp("payment_grace_until", { withTimezone: true }),

  /**
   * Per-user override of the monthly episode cap (admin-set).
   * Null = use the plan tier's episodesPerMonth from lib/tiers.ts.
   * Used for demo/deal registration: the owner authorizes a specific
   * episode allowance for a beta/demo user in advance.
   */
  episodeCapOverride: integer("episode_cap_override"),

  /**
   * UTC timestamp after which this user's access expires (admin-set).
   * Null = no expiry. When expired, the upload gate treats the user as
   * at-limit (0 episodes) until the owner extends or clears the date.
   * Used for time-boxed demo/deal access.
   */
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),

  /**
   * UTC timestamp when the owner suspended this user. Null = not suspended.
   * A suspended user cannot process episodes (upload gate returns limit 0)
   * regardless of plan or cap override. Set/cleared via /admin/users.
   */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),

  /**
   * Owner-entered reason for suspension (audit trail; shown in /admin/users).
   * Null when not suspended.
   */
  suspendedReason: text("suspended_reason"),

  /**
   * Audience persona for AI-generated content.
   * Stored at account level — applies to every episode processed.
   *
   * Values: "general" | "executive" | "creator" | "wellness" | "practitioner" | "fan" | "investor"
   * Default: "general" (all plans).
   * Premium personas (non-general) require Pro or Agency plan.
   * The persona is injected into every LLM system prompt via lib/personas.ts.
   */
  audiencePersona: text("audience_persona").notNull().default("general"),

  /**
   * Voice style profile extracted from the user's first episode transcript.
   * JSON string: { avgSentenceWords: number; formalityScore: number; humourMarkers: boolean }
   * Null until first episode is processed. Set by the pipeline; injected into subsequent prompts.
   * Sprint 3 feature — column added now, populated later.
   */
  voiceProfile: text("voice_profile"),

  /**
   * GCS object key for the user's uploaded brand logo.
   * Used in co-branded PDF header alongside PodLever mark.
   * PNG/JPG/WebP only; max 2MB; magic-byte validated before storage.
   * Sprint 2 feature — column added now, upload route added in Sprint 2.
   */
  logoStorageKey: text("logo_storage_key"),

  /**
   * When true, suppresses the "Powered by PodLever" watermark from generated PDFs.
   * Available to Pro and Agency plans only; gated in the PDF generator.
   * Default false — watermark visible for all free/beta users.
   */
  hidePodleverBranding: boolean("hide_podlever_branding").notNull().default(false),

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
