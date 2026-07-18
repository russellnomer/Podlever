/**
 * app/auth/logout/route.ts — Clears the PodLever session and redirects to home
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T6 — AuthProvider)
 *
 * Route: GET /auth/logout
 *
 * HUMAN REVIEW NOTES:
 * Logout is a GET (not POST) for simplicity in Phase 1A single-owner context.
 * In a multi-user production app, logout should be a POST with CSRF protection
 * to prevent logout CSRF (malicious pages triggering logout without user intent).
 * Phase 1B consideration: convert to POST + Server Action with CSRF token.
 *
 * This destroys the iron-session cookie, then redirects to home.
 * Replit's OIDC end-session endpoint is NOT called in Phase 1A (the user's
 * Replit account remains logged in; only the PodLever session is cleared).
 * Adding OIDC end-session is Phase 1B work if needed.
 *
 * Logs logout events for SOC compliance (user ID, timestamp).
 */

import { getIronSession } from "iron-session";
import { NextRequest, NextResponse } from "next/server";
import { getSessionOptions } from "@/providers/auth";
import type { PodLeverSession } from "@/providers/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/", request.url));

  // Read the session to capture userId for audit log before clearing
  const session = await getIronSession<PodLeverSession>(
    request,
    response,
    getSessionOptions(),
  );

  const userId = session.userId ?? "(unauthenticated)";

  // Destroy the session (clears the encrypted cookie)
  session.destroy();

  // Emit structured audit log (no PII — only DB user ID)
  console.log(JSON.stringify({
    event:     "auth.logout",
    userId,
    timestamp: new Date().toISOString(),
  }));

  return response;
}
