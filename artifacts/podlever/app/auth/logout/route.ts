/**
 * app/auth/logout/route.ts — Clears the PodLever session and redirects to home
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (Task #8 — session version increment at logout)
 *
 * Route: GET /auth/logout
 *
 * HUMAN REVIEW NOTES:
 * Logout is a GET (not POST) for simplicity in Phase 1A single-owner context.
 * In a multi-user production app, logout should be a POST with CSRF protection
 * to prevent logout CSRF (malicious pages triggering logout without user intent).
 * Phase 1B consideration: convert to POST + Server Action with CSRF token.
 *
 * Logout flow (in order):
 *   1. Read the iron-session cookie to obtain the userId for audit + DB update.
 *   2. Increment users.session_version in the DB (atomically via SQL expression).
 *      This instantly invalidates ALL active session cookies for this user —
 *      including any stolen copies — even if they are still unexpired.
 *   3. Destroy the iron-session cookie (instructs the browser to clear it).
 *   4. Redirect to home.
 *
 * Step 2 is the critical security step. Without it, a stolen cookie remains
 * valid for the full 7-day cookie lifetime. With it, the stolen cookie is
 * rejected at the next requireOwner() call because cookieVersion !== dbVersion.
 *
 * Logs logout events for SOC compliance (user ID, timestamp). No PII in logs.
 */

import { eq, sql } from "drizzle-orm";
import { getIronSession } from "iron-session";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionOptions } from "@/providers/auth";
import type { PodLeverSession } from "@/providers/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/", request.url));

  // ── Step 1: Read the session to get userId before clearing ───────────────────
  const session = await getIronSession<PodLeverSession>(
    request,
    response,
    getSessionOptions(),
  );

  const userId = session.userId ?? null;

  // ── Step 2: Increment session_version in DB (invalidates all existing cookies)
  //
  // This is the security-critical step. It runs even if the session cookie is
  // already absent or tampered — in which case userId is null and we skip safely.
  //
  // The SQL expression `session_version + 1` is an atomic server-side increment,
  // preventing a lost-update race in the (unlikely) concurrent logout scenario.
  if (userId) {
    try {
      await db
        .update(users)
        .set({
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt:      new Date(),
        })
        .where(eq(users.id, userId));
    } catch (err) {
      // Log but do not abort — always clear the cookie even if DB update fails.
      // The cookie destroy below still prevents the browser from sending it again.
      console.error(JSON.stringify({
        event:     "auth.logout.version_increment_failed",
        userId,
        error:     (err as Error).message,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  // ── Step 3: Destroy the session cookie ───────────────────────────────────────
  session.destroy();

  // ── Step 4: Emit structured audit log ────────────────────────────────────────
  console.log(JSON.stringify({
    event:     "auth.logout",
    userId:    userId ?? "(unauthenticated)",
    timestamp: new Date().toISOString(),
  }));

  return response;
}
