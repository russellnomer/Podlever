/**
 * app/auth/login/route.ts — Initiates the Replit OIDC/PKCE login flow
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-19 by agent (Task #38 — rate limiter now async; added await)
 *
 * Route: GET /auth/login
 * Path: /auth/ (not /api/) to avoid proxy routing conflict with api-server artifact
 *
 * HUMAN REVIEW NOTES:
 * This Route Handler is NOT a user mutation — it initiates an OIDC redirect.
 * It is exempt from the "Server Actions only" rule which applies to data mutations.
 *
 * Flow:
 *   1. Extract client IP; enforce sliding-window rate limit (10 req/min)
 *   2. Generate cryptographically random PKCE code_verifier, state, and nonce
 *   3. Store them in a short-lived iron-session cookie (pkce_state, 10 min TTL)
 *   4. Build the OIDC authorization URL (with S256 code_challenge)
 *   5. Redirect the user to Replit's OIDC authorization endpoint
 *
 * Security:
 *   - Rate limiting: 10 requests/minute per IP (sliding window, in-memory)
 *   - PKCE S256: prevents authorization code interception attacks
 *   - state: prevents CSRF
 *   - nonce: prevents ID token replay
 *   - Ephemeral PKCE cookie: httpOnly, secure (prod), SameSite=Lax, 10-min TTL
 */

import * as oidcClient from "openid-client";
import { getIronSession } from "iron-session";
import { NextRequest, NextResponse } from "next/server";
import { getOidcConfig, getCallbackUrl, getPkceStateOptions } from "@/providers/auth";
import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";
import { PostgresRateLimitStore } from "@/lib/rate-limit-store";
import type { PkceState } from "@/providers/auth";

// ─── Rate limiter ────────────────────────────────────────────────────────────

/**
 * loginRateLimiter — module-level singleton, shared across all requests in
 * this Node.js process. State is intentionally in-memory: single-instance
 * is the Phase 1B deployment model; state lost on restart is acceptable
 * (limits reset, which is a minor degradation, not a security failure).
 *
 * Limit: 10 requests per IP per 60-second sliding window.
 * Rationale: A legitimate user triggers this endpoint once per login session.
 * 10 req/min provides headroom for browser retries while blocking floods.
 *
 * Backed by PostgresRateLimitStore so the limit persists across restarts.
 * DB key format: "login:<ip>" (namespaced by PostgresRateLimitStore).
 */
const loginRateLimiter = new SlidingWindowRateLimiter(
  { max: 10, windowMs: 60_000 }, // 1-minute sliding window
  new PostgresRateLimitStore("login"),
);

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {

  // ── Step 1: Rate limit check ──────────────────────────────────────────────
  //
  // Extract the client IP from Replit's reverse-proxy headers and apply the
  // sliding-window limit BEFORE touching the OIDC provider. This prevents
  // repeated OIDC redirects from flooding Replit's authorization endpoint or
  // generating noisy PKCE cookie churn.

  const clientIp  = SlidingWindowRateLimiter.extractIp(request.headers);
  const rateLimit = await loginRateLimiter.check(clientIp);

  if (!rateLimit.allowed) {
    // Log at warn level so the owner can spot abuse patterns in workflow logs.
    // No PII: only the (possibly spoofed) IP and the rate-limit state.
    console.warn("[auth/login] rate limit exceeded", {
      ip:        clientIp,
      remaining: rateLimit.remaining,
      resetAt:   new Date(rateLimit.resetAt).toISOString(),
    });

    // Retry-After: seconds until the oldest in-window hit expires.
    const retryAfterSecs = Math.ceil((rateLimit.resetAt - Date.now()) / 1_000);

    return new NextResponse(
      `<html><body>
        <h1>Too many sign-in attempts</h1>
        <p>You have exceeded the sign-in rate limit. Please wait a moment and try again.</p>
        <p><a href="/">← Back to home</a></p>
      </body></html>`,
      {
        status:  429,
        headers: {
          "Content-Type":  "text/html",
          // Standard HTTP header: tells clients/proxies how long to wait.
          "Retry-After":   String(retryAfterSecs),
          // Expose remaining/reset as informational headers (non-sensitive).
          "X-RateLimit-Limit":     "10",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset":     String(rateLimit.resetAt),
        },
      },
    );
  }

  // ── Step 2–5: Normal OIDC login flow ──────────────────────────────────────

  try {
    // Load Replit OIDC discovery config (memoized after first fetch)
    const config = await getOidcConfig();

    // Generate cryptographically random PKCE material and CSRF state
    const codeVerifier = oidcClient.randomPKCECodeVerifier();
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
    const state = oidcClient.randomState();
    const nonce = oidcClient.randomNonce();

    // Build the OIDC authorization URL.
    // Pass `request` so getCallbackUrl() can derive the real public hostname from
    // the x-forwarded-host header — works in dev preview without any env vars set.
    const redirectUrl = oidcClient.buildAuthorizationUrl(config, {
      redirect_uri:          getCallbackUrl(request),
      scope:                 "openid profile email",
      code_challenge:        codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    // Create the redirect response first (iron-session writes cookie into it)
    const response = NextResponse.redirect(redirectUrl);

    // Store PKCE state in an encrypted short-lived cookie
    const pkceSession = await getIronSession<PkceState>(
      request,
      response,
      getPkceStateOptions(),
    );
    pkceSession.codeVerifier = codeVerifier;
    pkceSession.state        = state;
    pkceSession.nonce        = nonce;
    await pkceSession.save();

    return response;
  } catch (err) {
    // OIDC config fetch failed (network error, Replit OIDC down, missing REPL_ID)
    console.error("[auth/login] OIDC initialization failed:", err);

    // Return a plain error page rather than redirecting to avoid infinite loops
    return new NextResponse(
      `<html><body>
        <h1>Sign-in unavailable</h1>
        <p>Unable to connect to the authentication provider. Please try again later.</p>
        <p><a href="/">← Back to home</a></p>
      </body></html>`,
      {
        status:  503,
        headers: { "Content-Type": "text/html" },
      },
    );
  }
}
