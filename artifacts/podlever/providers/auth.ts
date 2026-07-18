/**
 * providers/auth.ts — Replit Auth (OIDC/PKCE) session management
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T6 — AuthProvider)
 *
 * Dependencies: iron-session (encrypted cookie sessions), openid-client v6
 *
 * HUMAN REVIEW NOTES:
 * This file is the single source of auth truth for PodLever.
 *
 * Session lifecycle:
 *   1. /auth/login  — initiates OIDC PKCE flow; stores ephemeral PKCE state in cookie
 *   2. /auth/callback — exchanges code for tokens; upserts user; writes PodLeverSession cookie
 *   3. Every Server Component / Server Action — calls getSession() to read auth state
 *   4. /auth/logout — clears PodLeverSession; redirects to home
 *
 * iron-session encrypts the session payload with SESSION_SECRET using AES-256-GCM.
 * The cookie is httpOnly + secure (in prod) + sameSite: lax.
 * Session data is NOT stored server-side — it lives entirely in the encrypted cookie.
 * Role is embedded in the session at login time; role changes require re-login.
 *
 * OIDC configuration (openid-client v6 functional API):
 *   - Issuer:       https://replit.com/oidc
 *   - Client ID:    REPL_ID (Replit auto-injects this)
 *   - Client type:  Public (PKCE, no client secret)
 *   - Redirect URI: https://{REPLIT_DEV_DOMAIN}/auth/callback
 *
 * Security invariants:
 *   - PKCE S256 code challenge on every login (no implicit flow)
 *   - state + nonce stored in a short-lived signed cookie; validated at callback
 *   - ID token signature verified by openid-client before trusting any claims
 *   - Session cookie: httpOnly; not accessible to client JS
 */

import * as oidcClient from "openid-client";
import type { Configuration } from "openid-client";
import { getIronSession } from "iron-session";
import type { IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

// ─── Session Types ────────────────────────────────────────────────────────────

/**
 * PodLeverSession — the data stored in the encrypted session cookie.
 *
 * Set at OIDC callback (login). Cleared at logout.
 * Role is embedded so the owner guard doesn't need a DB round-trip per request.
 * Changing a user's role in the DB takes effect on next login.
 */
export interface PodLeverSession {
  /** DB UUID of the authenticated user (matches users.id) */
  userId: string;
  /** Replit OIDC `sub` claim — the Replit user's numeric ID as a string */
  replitUserId: string;
  /** Display name from Replit OIDC profile */
  displayName: string;
  /** Role as stored in the DB at login time */
  role: "owner" | "user";
  /**
   * Session version — mirrors users.session_version at login time.
   * requireOwner() compares this against the live DB value on every privileged
   * request. Logout increments the DB value, instantly invalidating this cookie
   * even if it is still unexpired and cryptographically valid.
   */
  sessionVersion: number;
}

/**
 * PkceState — ephemeral PKCE state stored between /auth/login and /auth/callback.
 *
 * Stored in a short-lived separate iron-session cookie.
 * Consumed (validated and cleared) at callback; never persisted beyond the flow.
 */
export interface PkceState {
  /** PKCE code verifier — must match the code_challenge sent to the OIDC provider */
  codeVerifier: string;
  /** OAuth state parameter — prevents CSRF */
  state: string;
  /** OIDC nonce — prevents token replay */
  nonce: string;
}

// ─── Iron-Session configuration ───────────────────────────────────────────────

/**
 * SESSION_SECRET must be at least 32 characters.
 * Replit Secrets ensures it's present via config/index.ts.
 * We read it directly here to avoid circular imports with the config module.
 */
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short (must be ≥32 chars). " +
        "Set it via Replit Secrets.",
    );
  }
  return secret;
}

/**
 * getSessionOptions — Return the main session iron-session options.
 *
 * Returns a new options object each call so SESSION_SECRET is read at request
 * time rather than module-load time (avoids build-time env access issues).
 * iron-session's Password type requires a string; getSessionSecret() is called
 * here (not lazily via a thunk) so it satisfies the type.
 */
export function getSessionOptions(): SessionOptions {
  return {
    password:   getSessionSecret(),   // string — satisfies iron-session Password type
    cookieName: "podlever_session",
    cookieOptions: {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   60 * 60 * 24 * 7, // 7 days
      path:     "/",
    },
  };
}

/**
 * getPkceStateOptions — Return PKCE ephemeral cookie options.
 * Short-lived (10 min); consumed at callback and never persisted beyond the OIDC flow.
 */
export function getPkceStateOptions(): SessionOptions {
  return {
    password:   getSessionSecret(),
    cookieName: "podlever_pkce",
    cookieOptions: {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   60 * 10, // 10 minutes
      path:     "/auth",
    },
  };
}

// ─── Session helpers (Server Components + Server Actions) ─────────────────────

/**
 * getSession — Read the main session from the Next.js cookie store.
 *
 * Use in Server Components, Server Actions, and any server-side code that
 * has access to the Next.js request context (i.e., `cookies()` works).
 *
 * Returns an IronSession that may be empty ({}) if the user is not logged in.
 * Check `session.userId` to determine auth state.
 *
 * @returns IronSession<PodLeverSession> — empty or populated
 */
export async function getSession(): Promise<IronSession<PodLeverSession>> {
  const cookieStore = await cookies();
  return getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
}

/**
 * getAuthUser — Return the authenticated user or null.
 *
 * Convenience wrapper around getSession() that returns null when not logged in.
 * Does NOT throw — use requireOwner() for guarded contexts.
 *
 * @returns PodLeverSession if authenticated, null otherwise
 */
export async function getAuthUser(): Promise<PodLeverSession | null> {
  const session = await getSession();
  if (!session.userId) return null;
  return {
    userId:         session.userId,
    replitUserId:   session.replitUserId,
    displayName:    session.displayName,
    role:           session.role,
    sessionVersion: session.sessionVersion,
  };
}

// ─── OIDC Configuration (openid-client v6) ────────────────────────────────────

/**
 * REPLIT_OIDC_ISSUER — Replit's OIDC discovery URL.
 * The discovery endpoint is at {issuer}/.well-known/openid-configuration.
 */
export const REPLIT_OIDC_ISSUER = "https://replit.com/oidc";

/**
 * getOidcConfig — Fetch and return the Replit OIDC server configuration.
 *
 * Calls the OIDC discovery endpoint to get supported endpoints, algorithms, etc.
 * The result is memoized per process lifetime (safe: OIDC config rarely changes).
 * Uses `openid-client` v6 functional API: `client.discovery()`.
 *
 * @returns openid-client Configuration object
 */
let _oidcConfigCache: Configuration | null = null;

export async function getOidcConfig(): Promise<Configuration> {
  if (_oidcConfigCache) return _oidcConfigCache;

  const clientId = process.env.REPL_ID;
  if (!clientId) {
    throw new Error(
      "REPL_ID env var is not set. Replit should auto-inject this. " +
        "If running locally, set REPL_ID in .env.local.",
    );
  }

  // openid-client v6: functional discovery API (no class instantiation)
  // Fetches <issuer>/.well-known/openid-configuration and returns a Configuration
  _oidcConfigCache = await oidcClient.discovery(
    new URL(REPLIT_OIDC_ISSUER),
    clientId,
  );

  return _oidcConfigCache;
}

/**
 * getOwnerReplitUserId — Return the Replit user ID of the authorized owner.
 *
 * Resolution priority:
 *   1. OWNER_REPLIT_USER_ID — explicit override (set in Replit Secrets for multi-owner clarity)
 *   2. REPLIT_USERID        — auto-injected by Replit workspace (dev only)
 *
 * Exported so that only providers/ layer reads these env vars; route handlers
 * must call this function rather than reading process.env directly.
 *
 * @returns The owner's Replit numeric user ID string, or "" if not configured
 */
export function getOwnerReplitUserId(): string {
  return (
    process.env.OWNER_REPLIT_USER_ID ??
    process.env.REPLIT_USERID ??
    ""
  );
}

/**
 * getCallbackUrl — Build the OIDC callback URL for this environment.
 *
 * Resolution priority (first non-empty value wins):
 *   1. OIDC_CALLBACK_URL   — explicit override for any environment (set in Replit Secrets for prod)
 *   2. REPLIT_DEV_DOMAIN   — auto-injected by Replit in the dev workspace
 *   3. REPLIT_DOMAINS      — comma-separated list of domains injected in Replit deployments;
 *                            we take the first one
 *
 * The callback route is always at /auth/callback (not /api/ — avoids proxy conflict).
 *
 * Deployment checklist: set OIDC_CALLBACK_URL in Replit Secrets to the production URL
 * (e.g. https://podlever.com/auth/callback) before deploying to Autoscale.
 *
 * @returns Full HTTPS URL for the OIDC callback
 * @throws  If none of the domain env vars are set (prevents misconfigured OIDC silently)
 */
export function getCallbackUrl(): string {
  // 1. Explicit override — highest priority; set this in production
  if (process.env.OIDC_CALLBACK_URL) {
    return process.env.OIDC_CALLBACK_URL;
  }

  // 2. Dev workspace domain (auto-injected by Replit workspace)
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/auth/callback`;
  }

  // 3. Deployment domain (injected in Replit Autoscale; comma-separated, take first)
  if (process.env.REPLIT_DOMAINS) {
    const firstDomain = process.env.REPLIT_DOMAINS.split(",")[0]!.trim();
    return `https://${firstDomain}/auth/callback`;
  }

  throw new Error(
    "Cannot determine the OIDC callback URL. " +
      "Set OIDC_CALLBACK_URL in Replit Secrets (required for deployed environments), " +
      "or ensure REPLIT_DEV_DOMAIN / REPLIT_DOMAINS are set (auto-injected by Replit).",
  );
}
