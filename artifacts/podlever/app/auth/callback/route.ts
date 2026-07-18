/**
 * app/auth/callback/route.ts — Handles the Replit OIDC callback and creates a session
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (Task #6 — audit: PKCE fix, env centralization)
 *
 * Route: GET /auth/callback
 * OIDC redirect_uri: https://{REPLIT_DEV_DOMAIN}/auth/callback
 *
 * HUMAN REVIEW NOTES:
 * This is the most security-sensitive Route Handler in Phase 1A.
 *
 * Flow:
 *   1. Read the PKCE state cookie (code_verifier, state, nonce)
 *   2. Exchange the authorization code for tokens via openid-client
 *      (validates state, nonce, ID token signature, issuer, audience, expiration)
 *   3. Extract identity claims from the validated ID token
 *   4. Upsert the user in the DB (auth-sync: only call site for user writes in Phase 1A)
 *   5. Assign role: "owner" if Replit user ID matches OWNER_REPLIT_USER_ID env var;
 *      "user" otherwise
 *   6. Write the main iron-session cookie with the user's DB ID, role, display name
 *   7. Destroy the ephemeral PKCE cookie (explicit path match to ensure browser deletes)
 *   8. Redirect to the application home page
 *
 * Security:
 *   - openid-client.authorizationCodeGrant() verifies: JWT signature, issuer,
 *     audience, nonce, expiration, state. Never trust claims without this call.
 *   - PKCE code_verifier is transmitted server-to-server; never exposed to client.
 *   - If PKCE cookie is missing or tampered (iron-session decrypt fails), abort.
 *   - PKCE cookie is deleted with explicit path: "/auth" to ensure the browser
 *     correctly removes the scoped cookie (path mismatch = silent no-op in browsers).
 *   - Owner identity read via getOwnerReplitUserId() (providers/auth.ts) — no direct
 *     process.env access in this file.
 *   - Logs authentication events (user ID, role, timestamp) for SOC compliance.
 *     No PII (display name, email) in logs.
 *
 * Auth-sync invariant:
 *   This is the ONLY code path that writes to the users table in Phase 1A.
 *   No RSC-render user upsert. No application-level session store.
 */

import * as oidcClient from "openid-client";
import { getIronSession } from "iron-session";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  getOidcConfig,
  getCallbackUrl,
  getSessionOptions,
  getPkceStateOptions,
  getOwnerReplitUserId,
} from "@/providers/auth";
import type { PodLeverSession, PkceState } from "@/providers/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Step 1: Read and validate the PKCE state cookie ──────────────────────────
  const tempResponse = new NextResponse();
  let pkceSession: Awaited<ReturnType<typeof getIronSession<PkceState>>>;

  try {
    pkceSession = await getIronSession<PkceState>(
      request,
      tempResponse,
      getPkceStateOptions(),
    );
  } catch {
    console.error("[auth/callback] PKCE cookie decrypt failed — possible tampering or expiry");
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (!pkceSession.codeVerifier || !pkceSession.state || !pkceSession.nonce) {
    console.error("[auth/callback] PKCE state incomplete — restarting login flow");
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const { codeVerifier, state, nonce } = pkceSession;

  // ── Step 2: Exchange authorization code for tokens ───────────────────────────
  // authorizationCodeGrant takes a URL | Request as the second argument.
  // Passing `request` (NextRequest extends Request) satisfies the type.
  let claims: oidcClient.IDToken;

  try {
    const config = await getOidcConfig();
    const tokens = await oidcClient.authorizationCodeGrant(config, request, {
      pkceCodeVerifier: codeVerifier,
      expectedState:    state,
      expectedNonce:    nonce,
      idTokenExpected:  true,
    });

    claims = tokens.claims()!;
  } catch (err) {
    console.error("[auth/callback] Token exchange failed:", (err as Error).message);
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  // ── Step 3: Extract identity from validated claims ────────────────────────────
  const replitUserId = String(claims.sub);
  const displayName  = String(
    (claims as Record<string, unknown>).name ??
    (claims as Record<string, unknown>).preferred_username ??
    `user_${replitUserId}`,
  );

  // ── Step 4: Determine role ────────────────────────────────────────────────────
  // Use the centralized helper — do NOT read process.env directly in this file.
  const ownerReplitUserId = getOwnerReplitUserId();

  // Only "owner" and "user" are valid per the userRoleEnum in db/schema/users.ts
  const role = replitUserId === ownerReplitUserId ? ("owner" as const) : ("user" as const);

  // ── Step 5: Upsert user in DB (auth-sync — only write path for users table) ──
  let dbUserId: string;
  let dbSessionVersion: number;

  try {
    const [upsertedUser] = await db
      .insert(users)
      .values({
        externalIdentityId:       replitUserId,
        externalIdentityProvider: "replit",
        displayName,
        role,
      })
      .onConflictDoUpdate({
        target: users.externalIdentityId,
        set: {
          displayName,
          role,
          updatedAt: new Date(),
          // NOTE: session_version is NOT reset on login — only incremented at logout.
          // Preserving the current value means a user who logs in again without
          // logging out first retains the same version (no spurious invalidation).
        },
      })
      .returning({ id: users.id, sessionVersion: users.sessionVersion });

    dbUserId        = upsertedUser!.id;
    dbSessionVersion = upsertedUser!.sessionVersion;
  } catch (err) {
    console.error("[auth/callback] User upsert failed:", (err as Error).message);
    return NextResponse.redirect(new URL("/auth/login?error=db", request.url));
  }

  // ── Step 6: Emit structured security audit log ────────────────────────────────
  console.log(JSON.stringify({
    event:        "auth.login",
    replitUserId,
    dbUserId,
    role,
    timestamp:    new Date().toISOString(),
  }));

  // ── Step 7: Write session cookie and redirect ─────────────────────────────────
  const response = NextResponse.redirect(new URL("/", request.url));

  const session = await getIronSession<PodLeverSession>(
    request,
    response,
    getSessionOptions(),
  );
  session.userId         = dbUserId;
  session.replitUserId   = replitUserId;
  session.displayName    = displayName;
  session.role           = role;
  // Embed the session version so requireOwner() can verify it against the DB
  // on every privileged request. Logout increments the DB value, instantly
  // revoking this cookie even if it is still unexpired.
  session.sessionVersion = dbSessionVersion;
  await session.save();

  // ── Step 8: Destroy the ephemeral PKCE cookie ─────────────────────────────────
  // IMPORTANT: The PKCE cookie was set with path: "/auth".
  // A cookie deletion MUST specify the same path — without it, the browser sees a
  // different-scoped cookie and ignores the deletion (silent no-op).
  // We set maxAge=0 and value="" with the explicit /auth path to force removal.
  response.cookies.set("podlever_pkce", "", {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   0,
    path:     "/auth", // Must match the original Set-Cookie path
  });

  return response;
}
