/**
 * app/auth/login/route.ts — Initiates the Replit OIDC/PKCE login flow
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T6 — AuthProvider)
 *
 * Route: GET /auth/login
 * Path: /auth/ (not /api/) to avoid proxy routing conflict with api-server artifact
 *
 * HUMAN REVIEW NOTES:
 * This Route Handler is NOT a user mutation — it initiates an OIDC redirect.
 * It is exempt from the "Server Actions only" rule which applies to data mutations.
 *
 * Flow:
 *   1. Generate cryptographically random PKCE code_verifier, state, and nonce
 *   2. Store them in a short-lived iron-session cookie (pkce_state, 10 min TTL)
 *   3. Build the OIDC authorization URL (with S256 code_challenge)
 *   4. Redirect the user to Replit's OIDC authorization endpoint
 *
 * Security:
 *   - PKCE S256: prevents authorization code interception attacks
 *   - state: prevents CSRF
 *   - nonce: prevents ID token replay
 *   - Ephemeral PKCE cookie: httpOnly, secure (prod), SameSite=Lax, 10-min TTL
 */

import * as oidcClient from "openid-client";
import { getIronSession } from "iron-session";
import { NextRequest, NextResponse } from "next/server";
import { getOidcConfig, getCallbackUrl, getPkceStateOptions } from "@/providers/auth";
import type { PkceState } from "@/providers/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Load Replit OIDC discovery config (memoized after first fetch)
    const config = await getOidcConfig();

    // Generate cryptographically random PKCE material and CSRF state
    const codeVerifier = oidcClient.randomPKCECodeVerifier();
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
    const state = oidcClient.randomState();
    const nonce = oidcClient.randomNonce();

    // Build the OIDC authorization URL
    const redirectUrl = oidcClient.buildAuthorizationUrl(config, {
      redirect_uri:          getCallbackUrl(),
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
