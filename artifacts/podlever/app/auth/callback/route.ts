/**
 * app/auth/callback/route.ts — Handles the Replit OIDC callback and creates a session
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-24 by agent (session-loop fix: cookies() API, betaAccess lookup)
 *
 * Route: GET /auth/callback
 * OIDC redirect_uri: https://podlever.com/auth/callback (set via OIDC_CALLBACK_URL in prod)
 *
 * HUMAN REVIEW NOTES:
 * This is the most security-sensitive Route Handler in Phase 1A.
 *
 * Flow:
 *   1. Read the PKCE state cookie (code_verifier, state, nonce) via cookies() from next/headers
 *   2. Exchange the authorization code for tokens via openid-client
 *      (validates state, nonce, ID token signature, issuer, audience, expiration)
 *   3. Extract identity claims from the validated ID token
 *   4. Upsert the user in the DB (auth-sync: only call site for user writes in Phase 1A)
 *   5. Assign role: "owner" if Replit user ID matches OWNER_REPLIT_USER_ID env var;
 *      "user" otherwise
 *   6. Query the waitlist for betaAccess (non-fatal — missing entry → /verify-access)
 *   7. Write the main iron-session cookie via cookies() from next/headers
 *   8. Clear the ephemeral PKCE cookie
 *   9. Redirect to the application home page
 *
 * WHY cookies() from next/headers (not getIronSession(request, response, ...)):
 *   The (request, response) iron-session pattern works in Pages Router but is unreliable
 *   in Next.js 15 App Router Route Handlers when the response is a redirect (3xx).
 *   Replit's Cloud Run reverse proxy can strip Set-Cookie headers from redirect responses.
 *   cookies() from next/headers causes Next.js to inject the Set-Cookie headers at the
 *   framework level, guaranteeing they reach the browser regardless of response type.
 *   getSession() (the shared helper) already uses this pattern — this file now matches.
 *
 * Security:
 *   - openid-client.authorizationCodeGrant() verifies: JWT signature, issuer,
 *     audience, nonce, expiration, state. Never trust claims without this call.
 *   - PKCE code_verifier is transmitted server-to-server; never exposed to client.
 *   - If PKCE cookie is missing or tampered (iron-session decrypt fails), abort.
 *   - PKCE cookie is cleared with the explicit path "/auth" to ensure the browser
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
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, waitlist } from "@/db/schema";
import {
  getOidcConfig,
  getCallbackUrl,
  getSessionOptions,
  getPkceStateOptions,
  getOwnerReplitUserId,
} from "@/providers/auth";
import type { PodLeverSession, PkceState } from "@/providers/auth";
import { trackServerEvent } from "@/lib/analytics";

/**
 * authErrorRedirect — send the user to the visible /auth/error page instead of
 * silently bouncing back to /auth/login.
 *
 * Before 2026-07-26 every callback failure redirected straight to /auth/login,
 * which immediately re-initiated OIDC → the user experienced an INFINITE
 * consent loop with zero visible explanation (only server logs knew why).
 * Now the loop breaks at a human-readable error page that shows the failure
 * code + detail, so the user can screenshot it and retry deliberately.
 *
 * `detail` is truncated and passed in the URL — error messages from our own
 * auth stack (oidc-client / iron-session / drizzle) contain no secrets.
 */
function authErrorRedirect(appOrigin: string, code: string, detail: string): NextResponse {
  const url = new URL("/auth/error", appOrigin);
  url.searchParams.set("code", code);
  url.searchParams.set("detail", detail.slice(0, 300));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Derive the canonical public origin from proxy headers.
  // In Replit Autoscale, request.url is an internal address (http://localhost:PORT).
  // getCallbackUrl() reads OIDC_CALLBACK_URL (production) or REPLIT_DEV_DOMAIN (dev)
  // to get the real public hostname. Every redirect in this handler MUST use appOrigin.
  const canonicalCallbackUrl = getCallbackUrl(request);
  const appOrigin = new URL(canonicalCallbackUrl).origin; // e.g. https://podlever.com

  // Get the Next.js 15 App Router cookie store.
  // Using cookies() from next/headers (not the (request, response) iron-session pattern)
  // guarantees that Set-Cookie headers are injected at the framework level and survive
  // redirect (3xx) responses even through Replit's Cloud Run reverse proxy.
  const cookieStore = await cookies();

  // ── Step 1: Read and validate the PKCE state cookie ──────────────────────────
  let pkceSession: Awaited<ReturnType<typeof getIronSession<PkceState>>>;

  try {
    pkceSession = await getIronSession<PkceState>(cookieStore, getPkceStateOptions());
  } catch (err) {
    console.error(
      "[auth/callback] PKCE cookie decrypt failed — possible tampering, expiry, or secret mismatch:",
      (err as Error).message,
    );
    return authErrorRedirect(appOrigin, "pkce_decrypt", (err as Error).message);
  }

  if (!pkceSession.codeVerifier || !pkceSession.state || !pkceSession.nonce) {
    // Log which fields are missing to distinguish expired cookie from silent failure.
    console.error("[auth/callback] PKCE state incomplete", {
      hasCodeVerifier: !!pkceSession.codeVerifier,
      hasState:        !!pkceSession.state,
      hasNonce:        !!pkceSession.nonce,
      // Likely cause: PKCE cookie expired (10-min TTL), user took too long at consent,
      // or the cookie was not sent (domain/path mismatch). NOT a session-store issue —
      // iron-session is stateless/cookie-based and works across all Autoscale instances.
    });
    return authErrorRedirect(
      appOrigin,
      "pkce_missing",
      `verifier=${!!pkceSession.codeVerifier} state=${!!pkceSession.state} nonce=${!!pkceSession.nonce}`,
    );
  }

  const { codeVerifier, state, nonce, nextUrl } = pkceSession;

  // ── Step 2: Exchange authorization code for tokens ───────────────────────────
  // IMPORTANT: authorizationCodeGrant must receive a URL whose base matches
  // the redirect_uri sent in the original authorization request.
  //
  // In Replit Autoscale, request.url is an internal address such as
  // http://localhost:3000/auth/callback — passing it directly causes a
  // redirect_uri mismatch at Replit's token endpoint (invalid_grant error).
  //
  // Fix: construct a canonical URL from getCallbackUrl() and graft the original
  // query params (code, state, iss) onto it. This matches exactly what was sent
  // in the authorization request.
  let claims: oidcClient.IDToken;

  try {
    const config = await getOidcConfig();
    const canonicalUrl = new URL(canonicalCallbackUrl);
    canonicalUrl.search = new URL(request.url).search; // preserve ?code=&state=&iss=
    const tokens = await oidcClient.authorizationCodeGrant(config, canonicalUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState:    state,
      expectedNonce:    nonce,
      idTokenExpected:  true,
    });

    claims = tokens.claims()!;
  } catch (err) {
    console.error(
      "[auth/callback] Token exchange failed (invalid_grant, PKCE mismatch, or network error):",
      (err as Error).message,
    );
    return authErrorRedirect(appOrigin, "token_exchange", (err as Error).message);
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
    // Read UTM params from the short-lived utm cookie set by middleware
    let utmParams: Record<string, string> = {};
    try {
      const utmCookie = request.cookies.get("podlever_utm")?.value;
      if (utmCookie) utmParams = JSON.parse(utmCookie);
    } catch { /* ignore malformed cookie */ }

    const [upsertedUser] = await db
      .insert(users)
      .values({
        externalIdentityId:       replitUserId,
        externalIdentityProvider: "replit",
        displayName,
        role,
        // Store UTM on first insert only (first-touch attribution)
        utmSource:   utmParams.utm_source   ?? null,
        utmMedium:   utmParams.utm_medium   ?? null,
        utmCampaign: utmParams.utm_campaign ?? null,
        utmContent:  utmParams.utm_content  ?? null,
      })
      .onConflictDoUpdate({
        target: users.externalIdentityId,
        set: {
          displayName,
          role,
          updatedAt: new Date(),
          // NOTE: session_version is NOT reset on login — only incremented at logout.
          // NOTE: utm_* columns are intentionally NOT updated here (first-touch only).
        },
      })
      .returning({
        id:             users.id,
        sessionVersion: users.sessionVersion,
        createdAt:      users.createdAt,
        updatedAt:      users.updatedAt,
      });

    dbUserId         = upsertedUser!.id;
    dbSessionVersion = upsertedUser!.sessionVersion;

    // Detect new signup: createdAt and updatedAt within 5s means this was an INSERT
    const isNewUser = Math.abs(
      upsertedUser!.updatedAt.getTime() - upsertedUser!.createdAt.getTime()
    ) < 5000;

    // Fire analytics events (non-blocking)
    if (isNewUser) {
      trackServerEvent("signup", dbUserId, { role });
    }
    trackServerEvent("auth.login", dbUserId, { role });

  } catch (err) {
    console.error("[auth/callback] User upsert failed:", (err as Error).message);
    return authErrorRedirect(appOrigin, "db", (err as Error).message);
  }

  // ── Step 6: Emit structured security audit log ────────────────────────────────
  console.log(JSON.stringify({
    event:        "auth.login",
    replitUserId,
    dbUserId,
    role,
    timestamp:    new Date().toISOString(),
  }));

  // ── Step 7: Look up beta access from waitlist (non-owner users only) ─────────
  // The waitlist.replitUserId column is set when a user claims their invite via
  // /verify-access. If present, use that entry's status to determine betaAccess.
  // This is NON-FATAL: if the lookup fails, betaAccess stays undefined and the
  // middleware routes the user to /verify-access where they can claim their invite.
  //
  // betaAccess in session:
  //   "invited" → user is on the waitlist but hasn't completed onboarding
  //   "active"  → user has been onboarded; full product access
  //   undefined → not on waitlist; show /verify-access for self-declaration
  let betaAccess: PodLeverSession["betaAccess"];

  if (role !== "owner") {
    try {
      const waitlistEntry = await db
        .select({ status: waitlist.status })
        .from(waitlist)
        .where(eq(waitlist.replitUserId, replitUserId))
        .limit(1);

      const status = waitlistEntry[0]?.status;
      if (status === "invited" || status === "active") {
        betaAccess = status;
      }
    } catch (err) {
      // Non-fatal: user will be sent to /verify-access to self-declare.
      console.warn(
        "[auth/callback] betaAccess lookup failed (non-fatal):",
        (err as Error).message,
      );
    }
  }

  // ── Step 8: Write session cookie via cookies() from next/headers ──────────────
  // cookies() writes are injected at the Next.js framework level and are merged
  // into the returned response by Next.js — this works correctly even when the
  // response is a redirect (3xx), which is NOT guaranteed with getIronSession(
  // request, response, options) in App Router Route Handlers behind a proxy.
  // Role-aware landing (2026-07-26 — lead-to-cash funnel fix):
  //   "/dashboard" is the historical generic default that every CTA passed, but
  //   it renders the owner CRM. Treat it as "no explicit destination" and route
  //   by role: owner → /admin (console hub), everyone else → /dashboard/episodes
  //   (the actual product). Explicit deep links other than "/dashboard" are honored.
  let safeNext = nextUrl?.startsWith("/") ? nextUrl : "/dashboard";
  if (safeNext === "/dashboard" || safeNext === "/dashboard/") {
    safeNext = role === "owner" ? "/admin" : "/dashboard/episodes";
  }

  try {
    const session = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
    session.userId         = dbUserId;
    session.replitUserId   = replitUserId;
    session.displayName    = displayName;
    session.role           = role;
    session.sessionVersion = dbSessionVersion;
    if (betaAccess) session.betaAccess = betaAccess;
    await session.save();
  } catch (err) {
    console.error("[auth/callback] Session write failed:", (err as Error).message);
    return authErrorRedirect(appOrigin, "session", (err as Error).message);
  }

  // ── Step 9: Clear the ephemeral PKCE cookie ───────────────────────────────────
  // IMPORTANT: The PKCE cookie was set with path: "/auth".
  // Setting maxAge=0 with the same path forces removal.
  // Using cookieStore (same as the session write above) so the deletion is merged
  // into the response at the same framework-level injection point.
  cookieStore.set("podlever_pkce", "", {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   0,
    path:     "/auth", // Must match the original Set-Cookie path
  });

  // Return the redirect. Next.js 15 automatically merges all cookies() writes
  // (session + PKCE deletion) into this response's Set-Cookie headers.
  return NextResponse.redirect(new URL(safeNext, appOrigin));
}
