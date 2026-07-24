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
  /**
   * Beta access level for non-owner users — set at login time by checking
   * the waitlist table for a matching replitUserId.
   *
   * undefined / absent = no access → redirect to /verify-access
   * "invited"          = onboarding not yet completed → redirect to /onboarding
   * "active"           = full access to the product
   *
   * Owners always bypass this check (role === "owner").
   */
  betaAccess?: "invited" | "active";
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
  /** Intended destination after login — validated and honoured by /auth/callback */
  nextUrl?: string;
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
 * The function uses two entirely separate resolution paths based on NODE_ENV to
 * prevent dev-workspace variables (REPLIT_DEV_DOMAIN) from ever leaking into the
 * production OAuth flow — which would break login for all users on podlever.com.
 *
 * ── PRODUCTION (NODE_ENV === "production") ──────────────────────────────────
 *   1. OIDC_CALLBACK_URL  — REQUIRED. Set in Replit Secrets scoped to production:
 *                            https://podlever.com/auth/callback
 *                            A startup warning (instrumentation.ts) fires if absent.
 *   2. REPLIT_DOMAINS     — Emergency fallback only. Runtime-injected by Replit
 *                            Autoscale; points to the correct production domain but
 *                            does NOT guarantee a match with the registered redirect_uri
 *                            if a custom domain is in use. Always prefer OIDC_CALLBACK_URL.
 *   NEVER checked: REPLIT_DEV_DOMAIN (dev workspace domain, wrong domain for prod).
 *   NEVER checked: x-forwarded-host (request headers cannot be trusted for OAuth config).
 *
 * ── DEVELOPMENT / TEST ──────────────────────────────────────────────────────
 *   1. OIDC_CALLBACK_URL  — Optional explicit override for integration testing.
 *   2. REPLIT_DEV_DOMAIN  — Auto-injected by Replit; always the correct public URL.
 *                            Checked BEFORE x-forwarded-host because the iOS Replit app
 *                            routes requests through an internal proxy that sets
 *                            x-forwarded-host to a container-private IP (172.24.x.x,
 *                            10.x.x.x). These IPs pass a simple loopback check but are
 *                            unreachable from external browsers → Safari "restricted
 *                            network port" error after OAuth Allow.
 *   3. x-forwarded-host   — Derived from reverse-proxy headers. All RFC-1918 ranges
 *                            and loopback addresses are rejected (see isUnroutableAddress).
 *   4. REPLIT_DOMAINS     — Last resort (autoscale env used in testing without OIDC_CALLBACK_URL).
 *
 * The callback route is always /auth/callback (not /api/ — avoids proxy routing conflict).
 *
 * @param request  Optional incoming Request — used only in the dev path (priority 3) to
 *                 derive the host from x-forwarded-host when REPLIT_DEV_DOMAIN is absent.
 * @returns Full HTTPS URL for the OIDC callback
 * @throws  If no valid domain source is available (prevents silent misconfiguration)
 */
export function getCallbackUrl(request?: Request): string {
  const isProd = process.env.NODE_ENV === "production";

  // ── Production resolution path ─────────────────────────────────────────────
  if (isProd) {
    // 1. Explicit override — optional but takes priority when set.
    //    e.g. OIDC_CALLBACK_URL=https://podlever.com/auth/callback
    if (process.env.OIDC_CALLBACK_URL) {
      return process.env.OIDC_CALLBACK_URL;
    }

    // 2. REPLIT_DOMAINS — primary production mechanism.
    //    Set this to your custom domains, comma-separated:
    //      REPLIT_DOMAINS=podlever.com,www.podlever.com
    //    Replit Autoscale also auto-injects this at runtime. When multiple domains
    //    are present, we match against the incoming request host so the redirect_uri
    //    always equals the domain the user is actually on.
    if (process.env.REPLIT_DOMAINS) {
      const domains = process.env.REPLIT_DOMAINS
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);

      // Try to match the incoming request host to a registered domain.
      if (request) {
        const rawHost =
          request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
          new URL(request.url).hostname;
        const matched = domains.find((d) => d === rawHost);
        if (matched) {
          return `https://${matched}/auth/callback`;
        }
      }

      // No request or no host match — use the first (primary) domain.
      return `https://${domains[0]}/auth/callback`;
    }

    throw new Error(
      "Production misconfiguration: neither OIDC_CALLBACK_URL nor REPLIT_DOMAINS " +
        "is set. Add REPLIT_DOMAINS=podlever.com,www.podlever.com " +
        "(or OIDC_CALLBACK_URL=https://podlever.com/auth/callback) " +
        "to Replit Secrets (production environment) before deploying.",
    );
  }

  // ── Development / test resolution path ────────────────────────────────────
  // 1. Explicit override — useful for integration tests targeting a specific URL.
  if (process.env.OIDC_CALLBACK_URL) {
    return process.env.OIDC_CALLBACK_URL;
  }

  // 2. Replit dev workspace domain — always reliable in dev regardless of how
  //    the request reached the server (desktop proxy, iOS Replit app, etc.).
  //    Checked BEFORE x-forwarded-host to avoid container-IP leakage (see jsdoc).
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/auth/callback`;
  }

  // 3. Request-derived host — non-Replit environments where REPLIT_DEV_DOMAIN is absent.
  //    All RFC-1918 and loopback ranges are rejected: none are reachable from an
  //    external browser and would produce a permanently broken OAuth redirect_uri.
  if (request) {
    const host  = request.headers.get("x-forwarded-host");
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    if (host) {
      // x-forwarded-host may be a comma-separated list; take the first value.
      const primaryHost = host.split(",")[0]!.trim();
      const isUnroutableAddress =
        primaryHost.startsWith("0.0.0.0")  ||
        primaryHost.startsWith("localhost") ||
        primaryHost.startsWith("127.")      ||
        primaryHost.startsWith("::1")       ||
        primaryHost.startsWith("10.")       ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(primaryHost) || // 172.16–172.31
        primaryHost.startsWith("192.168.");
      if (!isUnroutableAddress) {
        return `${proto}://${primaryHost}/auth/callback`;
      }
    }
  }

  // 4. Last resort — autoscale domain in dev/test without OIDC_CALLBACK_URL.
  if (process.env.REPLIT_DOMAINS) {
    const firstDomain = process.env.REPLIT_DOMAINS.split(",")[0]!.trim();
    return `https://${firstDomain}/auth/callback`;
  }

  throw new Error(
    "Cannot determine the OIDC callback URL. " +
      "In production: set OIDC_CALLBACK_URL in Replit Secrets (production scope). " +
      "In development: ensure REPLIT_DEV_DOMAIN is injected by the Replit workspace.",
  );
}
