/**
 * config/index.ts — Typed environment configuration for PodLever
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T4 + T6 — updated with Replit Auth vars)
 *
 * Dependencies: zod (runtime schema validation)
 *
 * HUMAN REVIEW NOTES:
 * This is the SINGLE point of truth for all environment variable access.
 * No other file may import `process.env` directly — they must import from here.
 *
 * Rule: If a new env var is needed, add it here AND in /.env.example.
 *
 * Fail-fast design: if a required variable is missing or malformed, this module
 * throws at startup (before any request is handled), with a clear human-readable
 * error listing every invalid field.
 *
 * Auth mechanism: Replit Auth (OIDC/PKCE) — confirmed T3.
 * REPL_ID and REPLIT_DEV_DOMAIN are auto-injected by Replit.
 * OWNER_REPLIT_USER_ID defaults to REPLIT_USERID (workspace owner's Replit ID).
 */

import { z } from "zod";

/**
 * EnvSchema — Zod schema for all PodLever environment variables.
 *
 * Business context: Validates every env var at startup. Adding new infrastructure
 * (queues, storage, AI APIs) in Phase 1B requires adding entries here.
 */
const EnvSchema = z.object({
  // ─── Server ────────────────────────────────────────────────────────────────
  /** HTTP port. Injected by Replit workflow runner. Defaults to 3000 for local dev. */
  PORT: z.coerce.number().int().positive().default(3000),

  /** Node environment. Controls logging verbosity and error detail. */
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // ─── Database ──────────────────────────────────────────────────────────────
  /** PostgreSQL connection string. Auto-provisioned by Replit. Required. */
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required — provision via Replit PostgreSQL"),

  // ─── AI Providers (pipeline engine) ────────────────────────────────────────
  /**
   * Deepgram API key — transcription (Nova-3). Set via Replit Secrets.
   * Required for the transcription pipeline step.
   */
  DEEPGRAM_API_KEY: z
    .string()
    .min(1, "DEEPGRAM_API_KEY is required — set via Replit Secrets"),

  /**
   * Anthropic API key — writing (Claude Sonnet 4.5). Set via Replit Secrets.
   * Required for show-notes / blog / social generation steps.
   */
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY is required — set via Replit Secrets"),

  // ─── Session / Security ────────────────────────────────────────────────────
  /**
   * Secret for encrypting iron-session cookies (AES-256-GCM via iron-session).
   * Must be >= 32 characters. Stored in Replit Secrets — never in .env files.
   */
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters — set via Replit Secrets"),

  // ─── Replit Platform (auto-injected by Replit) ────────────────────────────
  /**
   * Replit Repl ID — used as the OIDC client ID for Replit Auth (PKCE public client).
   * Auto-injected by Replit in the workspace and in deployed autoscale containers.
   */
  REPL_ID: z
    .string()
    .min(1, "REPL_ID is required — should be auto-injected by Replit")
    .optional(), // Optional in config validation (read directly in auth.ts for lazy eval)

  /**
   * Replit dev domain — used to construct the OIDC callback URL in development.
   * Format: "<repl-slug>.<username>.repl.co" or similar.
   * Auto-injected by Replit.
   */
  REPLIT_DEV_DOMAIN: z.string().optional(),

  /**
   * The Replit numeric user ID of the authorized owner.
   * Used in the OIDC callback to assign role="owner" to the correct user.
   * Defaults to REPLIT_USERID (the workspace creator's Replit ID) if not set.
   *
   * To set explicitly: add OWNER_REPLIT_USER_ID=<your-replit-user-id> to Replit Secrets.
   * To find your Replit user ID: print process.env.REPLIT_USERID in the workspace.
   */
  OWNER_REPLIT_USER_ID: z.string().optional(),

  /**
   * Replit workspace user ID — available in dev workspace only.
   * Used as fallback for OWNER_REPLIT_USER_ID if not explicitly set.
   * NOT available in deployed autoscale containers (set OWNER_REPLIT_USER_ID explicitly).
   */
  REPLIT_USERID: z.string().optional(),

  /**
   * Replit workspace username — available in dev workspace only.
   * Not used in auth logic; available for dev tooling.
   */
  REPLIT_USER: z.string().optional(),
});

// ─── Parse and export ──────────────────────────────────────────────────────────

/**
 * parseEnv — Validate process.env against EnvSchema at startup.
 *
 * Throws with a human-readable field-by-field failure list if any required
 * variable is missing or malformed. Intentional fail-fast design.
 */
function parseEnv() {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  • ${e.path.join(".")}: ${e.message}`)
      .join("\n");

    throw new Error(
      `\n🚨 PodLever startup failed — invalid environment configuration:\n${errors}\n\nCheck /.env.example for required variables.\n`,
    );
  }

  return result.data;
}

/**
 * config — Typed, validated environment configuration.
 *
 * Use this in all server modules instead of reading process.env directly.
 * Parsed once at module load; cached for the lifetime of the process.
 *
 * Example:
 *   import { config } from "@/config";
 *   const url = config.DATABASE_URL;
 */
export const config = parseEnv();

/** Config — TypeScript type for the validated configuration object. */
export type Config = typeof config;
