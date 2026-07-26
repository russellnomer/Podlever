/**
 * middleware.ts — Next.js App Router middleware for authentication + beta access gate
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #55 — Beta invite & onboarding)
 *
 * Runs on every matched request BEFORE the route handler/page is rendered.
 * Uses iron-session to decrypt the session cookie and read auth state without
 * hitting the database (the session already embeds role + betaAccess at login time).
 *
 * Access rules (updated 2026-07-26 — self-serve free trial opened):
 *   PUBLIC paths   → always allowed (no auth required)
 *   /auth/*        → always allowed (login/callback/logout)
 *   /verify-access → allowed for authenticated users (claim a beta invite)
 *   /waitlisted    → always allowed (holding page)
 *   /onboarding    → allowed for invited + active users (and owner)
 *   /dashboard     → owner CRM; non-owners are redirected to /dashboard/episodes
 *   /dashboard/episodes/* → any authenticated user (free trial or beta)
 *
 * For non-owner users without a session: redirect to /auth/login.
 * For authenticated users with no betaAccess claim: allowed into the product on
 *   the FREE TRIAL plan (users.plan defaults to "free" — 1 lifetime episode,
 *   60-minute cap, enforced at the upload gate). Matches the public pricing
 *   promise; abuse is bounded by the trial cap and the /admin/users controls.
 * For invited (not yet active) non-owner users: redirect to /onboarding.
 *
 * SECURITY NOTES:
 *   - Session cookie decryption uses SESSION_SECRET (AES-256-GCM via iron-session).
 *   - Role and betaAccess are embedded at login time; changes take effect on next login.
 *   - No database query in middleware (performance critical path).
 *   - This is NOT a substitute for requireOwner() guards in Server Actions/Routes —
 *     those are the authoritative server-side enforcement layer. This middleware
 *     provides UX routing only (defense in depth).
 */

import { NextRequest, NextResponse } from "next/server";
import { getIronSession }            from "iron-session";
import type { PodLeverSession }      from "@/providers/auth";

// ─── Session options (duplicated from providers/auth.ts to avoid importing Node-only modules) ────

function getMiddlewareSessionOptions() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET env var is not set");
  return {
    cookieName: "podlever_session",
    password:   secret,
    cookieOptions: {
      secure:   process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge:   60 * 60 * 24 * 30, // 30 days
      path:     "/",
    },
  };
}

// ─── Route classification ────────────────────────────────────────────────────

/** Paths that require no authentication whatsoever. */
const PUBLIC_PREFIXES = [
  "/",
  "/pricing",
  "/help",
  "/privacy",
  "/terms",
  "/sitemap.xml",
  "/robots.txt",
  "/_next/",
  "/favicon",
  "/opengraph-image",
  // API routes handle their own authentication internally.
  // The matcher config attempts to exclude /api/ paths but the regex lookahead
  // does not reliably prevent the middleware from running on API routes in all
  // Next.js versions. Listing /api/ here guarantees those routes are always
  // passed through — they enforce auth themselves via requireOwner() /
  // requireBetaUser() guards in the route handlers.
  "/api/",
];

/** Auth flow routes — always open. No trailing slashes — isAuthPath appends "/" for prefix matching. */
const AUTH_PATHS = ["/auth", "/verify-access", "/waitlisted", "/onboarding"];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => p !== "/" && pathname.startsWith(p));
}

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // ── Always allow static + public pages ────────────────────────────────────
  if (isPublicPath(pathname) || isAuthPath(pathname)) {
    const res = NextResponse.next();
    captureUtmParams(request, res);
    return res;
  }

  // ── Read session from cookie (no DB hit) ─────────────────────────────────
  const response = NextResponse.next();
  let session: PodLeverSession | null = null;

  try {
    const raw = await getIronSession<PodLeverSession>(
      request,
      response,
      getMiddlewareSessionOptions(),
    );
    if (raw.userId) session = raw as PodLeverSession;
  } catch {
    // Tampered or expired cookie — treat as unauthenticated
  }

  // ── Unauthenticated → login ───────────────────────────────────────────────
  if (!session) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Owner → full access ───────────────────────────────────────────────────
  if (session.role === "owner") {
    return NextResponse.next();
  }

  // ── Non-owner: route into the product ─────────────────────────────────────
  const { betaAccess } = session;

  if (betaAccess === "invited") {
    // Invited but not yet onboarded — funnel to onboarding
    if (!pathname.startsWith("/onboarding")) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
    return NextResponse.next();
  }

  // The /dashboard root is the owner CRM — non-owners get the product home.
  // (The page itself also rejects non-owners; this just gives them a sane
  // landing instead of a bounce to the marketing site.)
  if (pathname === "/dashboard") {
    return NextResponse.redirect(new URL("/dashboard/episodes", request.url));
  }

  // No betaAccess claim → self-serve FREE TRIAL access (plan="free" by default:
  // 1 lifetime episode, 60-minute cap, enforced at the upload gate in the DB).
  // This matches the public pricing page promise ("Get started free — no card").
  // Invited beta users still claim Pro-equivalent access via /verify-access.
  // betaAccess === "active" → full beta product access.
  return NextResponse.next();
}

// ─── UTM capture ─────────────────────────────────────────────────────────────

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;
const UTM_COOKIE = "podlever_utm";
const UTM_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * captureUtmParams — Read UTM query params from the request URL and write
 * them to a short-lived cookie (podlever_utm) for first-touch attribution.
 *
 * Only sets the cookie if UTM params are present AND the cookie doesn't
 * already exist (first-touch — never overwrite with a later visit's UTMs).
 */
function captureUtmParams(request: NextRequest, response: NextResponse): void {
  if (request.cookies.has(UTM_COOKIE)) return; // already captured
  const { searchParams } = request.nextUrl;
  const utms: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const val = searchParams.get(key);
    if (val) utms[key] = val.slice(0, 200); // cap length
  }
  if (Object.keys(utms).length === 0) return;
  response.cookies.set(UTM_COOKIE, JSON.stringify(utms), {
    httpOnly: false,   // readable in auth callback (server-to-server same-process)
    sameSite: "lax",
    maxAge:   UTM_MAX_AGE,
    path:     "/",
  });
}

// ─── Matcher — run on all app routes except Next.js internals ────────────────

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     *   - _next/static  (static assets)
     *   - _next/image   (Next.js image optimization)
     *   - api/          (API routes handle their own auth)
     *   - rpc/          (internal routes — authenticated via CRON_SECRET)
     *   - favicon.ico
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|rpc/).*)",
  ],
};
