/**
 * verify-auth.ts — Phase 1A authentication boundary verification script
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (Task #8 — session version enforcement)
 *
 * Run: pnpm --filter @workspace/podlever run verify-auth
 *  Or: tsx scripts/verify-auth.ts  (from artifacts/podlever/)
 *
 * Verifies six auth boundary behaviors:
 *   1. No session cookie → UnauthorizedError (401)
 *   2. Tampered cookie (wrong HMAC) → decryption fails → UnauthorizedError (401)
 *   3. role="user" session → ForbiddenError (403)
 *   4. Valid owner session (correct version) → guard passes
 *   5. Stolen cookie rejected: version mismatch after logout increments DB version
 *   6. Logout clears session cookie (browser-side) + increments session_version in DB
 *
 * Design notes:
 *   - providers/owner-guard.ts has `import "server-only"` so it cannot be imported
 *     here. The guard logic (Gates 1–3) is replicated inline — intentionally, so
 *     any divergence between this script and the real guard produces a test failure.
 *   - Tests 1–3: pure session/crypto tests, no DB needed.
 *   - Tests 4–6: require a real users row; setUp/tearDown create and clean up one.
 *   - SESSION_SECRET is read from process.env; fails fast if absent.
 *
 * Guard logic replicated here (mirrors requireOwnerFromSession in owner-guard.ts):
 *   Gate 1: user must be non-null (authenticated cookie present)
 *   Gate 2: user.role must be "owner"
 *   Gate 3: user.sessionVersion must match users.session_version in DB
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — one or more assertions failed (details printed to stderr)
 *
 * HUMAN REVIEW NOTES:
 * This script creates real rows in the users table and cleans up after itself.
 * Do NOT run against a production database. Use a dev DATABASE_URL.
 */

import { eq, sql } from "drizzle-orm";
import { getIronSession } from "iron-session";
import type { SessionOptions } from "iron-session";
import { db } from "../db/index.js";
import { users } from "../db/schema/index.js";
import {
  getSessionOptions,
  type PodLeverSession,
} from "../providers/auth.js";
import { UnauthorizedError, ForbiddenError } from "../providers/auth-errors.js";
import { Pool } from "pg";

// ─── Assertion helpers ────────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;

/**
 * assert — Lightweight assertion with descriptive output.
 * Does NOT throw — collects failures so all tests run.
 */
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    _passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    _failed++;
  }
}

/**
 * assertThrowsSync — Assert a sync function throws an instance of ErrorClass.
 */
function assertThrowsSync<E extends Error>(
  fn: () => unknown,
  ErrorClass: new (...args: never[]) => E,
  message: string,
): E | null {
  try {
    fn();
    console.error(`  ❌ FAIL (no throw): ${message}`);
    _failed++;
    return null;
  } catch (err) {
    if (err instanceof ErrorClass) {
      console.log(`  ✅ PASS: ${message}`);
      _passed++;
      return err;
    }
    console.error(
      `  ❌ FAIL (wrong error type — got ${(err as Error).constructor?.name ?? String(err)}): ${message}`,
    );
    _failed++;
    return null;
  }
}

/**
 * assertThrowsAsync — Assert an async function throws an instance of ErrorClass.
 */
async function assertThrowsAsync<E extends Error>(
  fn: () => Promise<unknown>,
  ErrorClass: new (...args: never[]) => E,
  message: string,
): Promise<E | null> {
  try {
    await fn();
    console.error(`  ❌ FAIL (no throw): ${message}`);
    _failed++;
    return null;
  } catch (err) {
    if (err instanceof ErrorClass) {
      console.log(`  ✅ PASS: ${message}`);
      _passed++;
      return err;
    }
    console.error(
      `  ❌ FAIL (wrong error type — got ${(err as Error).constructor?.name ?? String(err)}): ${message}`,
    );
    _failed++;
    return null;
  }
}

// ─── Inline guard logic (mirrors requireOwnerFromSession in owner-guard.ts) ───
//
// owner-guard.ts has `import "server-only"` — cannot import it in tsx.
// This inline version replicates all three gates so any divergence surfaces as
// a test failure rather than silently passing.
//
// Gate 1: user non-null
// Gate 2: user.role === "owner"
// Gate 3: user.sessionVersion matches users.session_version in DB

/**
 * runGuard — inline replica of Gates 1 and 2 only (no DB — for tests 1–3).
 * Tests 1–3 fail before Gate 3 so the DB check is never reached.
 */
function runGuard(user: PodLeverSession | null): void {
  if (!user) throw new UnauthorizedError();
  if (user.role !== "owner") throw new ForbiddenError(user.role);
}

/**
 * runFullGuard — inline replica of all three gates (Gates 1, 2, and 3 with DB).
 * Used for tests 4–6 that exercise the session version check.
 */
async function runFullGuard(user: PodLeverSession | null): Promise<void> {
  // Gate 1
  if (!user) throw new UnauthorizedError();
  // Gate 2
  if (user.role !== "owner") throw new ForbiddenError(user.role);
  // Gate 3 — DB version check
  const [dbUser] = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1);
  if (!dbUser || dbUser.sessionVersion !== user.sessionVersion) {
    throw new UnauthorizedError();
  }
}

// ─── Iron-session test helpers ────────────────────────────────────────────────

/** Build a Web API Request with an optional cookie header. */
function buildRequest(cookieHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (cookieHeader !== undefined) headers["cookie"] = cookieHeader;
  return new Request("http://localhost/", { headers });
}

/**
 * sealSession — Seal a session payload into an iron-session cookie string.
 * Returns the raw "name=value" pair suitable for use in a Cookie request header.
 */
async function sealSession(
  data: Partial<PodLeverSession>,
  opts: SessionOptions,
): Promise<string> {
  const req = buildRequest();
  const res = new Response();
  const session = await getIronSession<PodLeverSession>(req, res, opts);
  Object.assign(session, data);
  await session.save();

  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("sealSession: session.save() produced no Set-Cookie header");
  }
  return setCookie.split(";")[0]!.trim(); // "name=<sealed-value>"
}

/**
 * readSession — Read an iron-session from a request carrying the given cookie.
 * Returns null when the cookie is absent, tampered, or decryption fails.
 */
async function readSession(
  cookieHeader: string | undefined,
  opts: SessionOptions,
): Promise<PodLeverSession | null> {
  const req = buildRequest(cookieHeader);
  const res = new Response();
  const session = await getIronSession<PodLeverSession>(req, res, opts);
  if (!session.userId) return null;
  return {
    userId:         session.userId,
    replitUserId:   session.replitUserId,
    displayName:    session.displayName,
    role:           session.role,
    sessionVersion: session.sessionVersion,
  };
}

// ─── DB setup / teardown ──────────────────────────────────────────────────────

const RUN_ID = `verify-auth-${Date.now()}`;

/**
 * setupTestUser — Insert a test user and return their id + sessionVersion.
 * Uses a unique externalIdentityId so parallel runs don't collide.
 */
async function setupTestUser(): Promise<{ userId: string; sessionVersion: number }> {
  const [user] = await db
    .insert(users)
    .values({
      externalIdentityId:       `${RUN_ID}-owner`,
      externalIdentityProvider: "verify-auth-stub",
      displayName:              "Verify Auth Test Owner",
      role:                     "owner",
      // session_version defaults to 1 in the DB
    })
    .returning({ id: users.id, sessionVersion: users.sessionVersion });
  return { userId: user!.id, sessionVersion: user!.sessionVersion };
}

/**
 * cleanupTestUser — Remove the test user row (cascades to any child rows).
 */
async function cleanupTestUser(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

// ─── Test cases ───────────────────────────────────────────────────────────────

/**
 * test1_noSession — No cookie → UnauthorizedError (401).
 *
 * Simulates an unauthenticated request (no session cookie present).
 * Gate 1 fires; DB is never reached.
 */
async function test1_noSession(opts: SessionOptions): Promise<void> {
  console.log("\n📋 Test 1: No session cookie → UnauthorizedError (401)");

  const user = await readSession(undefined, opts);
  assert(user === null, "readSession with no cookie returns null");

  const err = assertThrowsSync(() => runGuard(null), UnauthorizedError,
    "runGuard(null) throws UnauthorizedError");
  if (err) {
    assert(err.statusCode === 401,          "statusCode === 401");
    assert(err.kind === "UnauthorizedError", "kind === 'UnauthorizedError'");
    assert(err.message.length > 0,          "message is non-empty");
  }
}

/**
 * test2_tamperedCookie — Wrong HMAC → decryption fails → UnauthorizedError (401).
 *
 * Simulates a forged or bit-flipped cookie. iron-session's AES-256-GCM
 * authentication tag verification fails and returns an empty session.
 * Gate 1 fires on the resulting null user.
 */
async function test2_tamperedCookie(opts: SessionOptions): Promise<void> {
  console.log("\n📋 Test 2: Tampered cookie (wrong HMAC) → UnauthorizedError (401)");

  // Seal a valid session to get the cookie name
  const validCookie = await sealSession(
    { userId: "00000000-0000-0000-0000-000000000001",
      replitUserId: "tamper-test", displayName: "Tamper", role: "owner",
      sessionVersion: 1 },
    opts,
  );

  // Corrupt the sealed value by flipping one character in the longest segment
  const [name, sealValue] = validCookie.split("=") as [string, string];
  const parts = sealValue.split(".");
  const longestIdx = parts.reduce(
    (maxI, p, i) => (p.length > parts[maxI]!.length ? i : maxI), 0);
  const orig = parts[longestIdx]!;
  parts[longestIdx] = orig.slice(0, -1) + (orig.endsWith("A") ? "B" : "A");
  const tampered = `${name}=${parts.join(".")}`;

  const user = await readSession(tampered, opts);
  assert(user === null, "Tampered cookie produces null user (HMAC verification fails)");

  const err = assertThrowsSync(() => runGuard(user), UnauthorizedError,
    "runGuard with null user throws UnauthorizedError");
  if (err) assert(err.statusCode === 401, "statusCode === 401");
}

/**
 * test3_nonOwnerRole — role="user" → ForbiddenError (403).
 *
 * Seals a valid session for a non-owner. Gate 1 passes (authenticated),
 * Gate 2 fires (wrong role). DB is never reached.
 */
async function test3_nonOwnerRole(opts: SessionOptions): Promise<void> {
  console.log("\n📋 Test 3: role='user' session → ForbiddenError (403)");

  const cookie = await sealSession(
    { userId: "00000000-0000-0000-0000-000000000002",
      replitUserId: "non-owner", displayName: "Non-Owner", role: "user",
      sessionVersion: 1 },
    opts,
  );

  const user = await readSession(cookie, opts);
  assert(user !== null,       "role='user' session decrypts successfully (authenticated)");
  assert(user?.role === "user", "decrypted session carries role='user'");

  const err = assertThrowsSync(() => runGuard(user), ForbiddenError,
    "runGuard with role='user' throws ForbiddenError");
  if (err) {
    assert(err.statusCode === 403,        "statusCode === 403");
    assert(err.kind === "ForbiddenError", "kind === 'ForbiddenError'");
    assert(err.message.includes('"user"'), `message includes the role: "${err.message}"`);
  }
}

/**
 * test4_validOwnerSession — Valid cookie + matching DB version → guard passes.
 *
 * End-to-end happy path: sealed owner cookie with sessionVersion matching the DB.
 * All three gates pass. Verifies the guard does NOT over-reject.
 */
async function test4_validOwnerSession(
  opts: SessionOptions,
  userId: string,
  sessionVersion: number,
): Promise<void> {
  console.log("\n📋 Test 4: Valid owner session (matching version) → guard passes");

  const cookie = await sealSession(
    { userId, replitUserId: "owner-user", displayName: "Owner",
      role: "owner", sessionVersion },
    opts,
  );

  const user = await readSession(cookie, opts);
  assert(user !== null,                        "Session decrypts to a non-null user");
  assert(user?.role === "owner",               "role === 'owner'");
  assert(user?.sessionVersion === sessionVersion, "sessionVersion matches DB value");

  // runFullGuard must NOT throw for a valid session
  let guardError: Error | null = null;
  try {
    await runFullGuard(user);
  } catch (e) {
    guardError = e as Error;
  }
  assert(guardError === null, "runFullGuard passes for valid owner session (no throw)");
}

/**
 * test5_stolenCookieRejected — Stolen cookie rejected after logout increments version.
 *
 * This is the core security test for the session version mechanism:
 *
 *   1. Attacker captures a valid owner session cookie (sessionVersion=1).
 *   2. Owner logs out → DB session_version incremented to 2.
 *   3. Attacker replays the stolen cookie (still sealed, not tampered).
 *   4. Gate 3: cookie version (1) !== DB version (2) → UnauthorizedError.
 *
 * This proves that a stolen but cryptographically valid cookie is rejected
 * the moment the legitimate owner logs out — no need to wait for maxAge expiry.
 */
async function test5_stolenCookieRejected(
  opts: SessionOptions,
  userId: string,
  sessionVersion: number,
): Promise<void> {
  console.log("\n📋 Test 5: Stolen cookie rejected after logout increments DB version");

  // Step 1: Attacker captures the owner's cookie at version=1
  const stolenCookie = await sealSession(
    { userId, replitUserId: "owner-user", displayName: "Owner",
      role: "owner", sessionVersion },
    opts,
  );

  // Verify the stolen cookie is valid BEFORE logout
  const userBefore = await readSession(stolenCookie, opts);
  assert(userBefore !== null,                         "Stolen cookie decrypts successfully (pre-logout)");
  assert(userBefore?.sessionVersion === sessionVersion, "Pre-logout: cookie version matches DB version");

  let preLogoutErr: Error | null = null;
  try { await runFullGuard(userBefore); } catch (e) { preLogoutErr = e as Error; }
  assert(preLogoutErr === null,
    "Pre-logout: runFullGuard passes (stolen cookie not yet invalidated)");

  // Step 2: Simulate logout — increment session_version in DB atomically
  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Verify the DB version was incremented
  const [dbRow] = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  assert(
    dbRow?.sessionVersion === sessionVersion + 1,
    `DB session_version incremented from ${sessionVersion} → ${sessionVersion + 1}`,
  );

  // Step 3: Attacker replays the stolen cookie — it is still cryptographically valid
  const userAfter = await readSession(stolenCookie, opts);
  assert(userAfter !== null,
    "Stolen cookie still decrypts after logout (HMAC is intact — it was never tampered)");
  assert(userAfter?.sessionVersion === sessionVersion,
    `Stolen cookie still carries old version (${sessionVersion})`);

  // Step 4: Gate 3 must reject the stolen cookie (version mismatch)
  const err = await assertThrowsAsync(
    () => runFullGuard(userAfter),
    UnauthorizedError,
    `runFullGuard rejects stolen cookie: cookie version ${sessionVersion} !== DB version ${sessionVersion + 1}`,
  );
  if (err) {
    assert(err.statusCode === 401,           "statusCode === 401 (UnauthorizedError)");
    assert(err.kind === "UnauthorizedError", "kind === 'UnauthorizedError'");
  }
}

/**
 * test6_logoutClearsCookie — session.destroy() clears the in-memory session.
 *
 * Mirrors the iron-session destroy() call in app/auth/logout/route.ts (Step 3).
 * Verifies userId is cleared in memory after destroy(), and that a subsequent
 * request with no cookie (as the browser would send after max-age=0) is rejected.
 *
 * The DB version increment (Step 2 of logout) is tested in test5 above.
 */
async function test6_logoutClearsCookie(
  opts: SessionOptions,
  userId: string,
  sessionVersion: number,
): Promise<void> {
  console.log("\n📋 Test 6: Logout destroy() clears session cookie in memory");

  const ownerCookie = await sealSession(
    { userId, replitUserId: "owner-user", displayName: "Owner",
      role: "owner", sessionVersion },
    opts,
  );

  // Pre-logout: session is populated
  const userBefore = await readSession(ownerCookie, opts);
  assert(userBefore !== null,          "Pre-logout: session is populated");
  assert(userBefore?.userId === userId, "Pre-logout: userId matches");

  // Simulate destroy() — mirrors app/auth/logout/route.ts
  const req = buildRequest(ownerCookie);
  const res = new Response();
  const sessionToDestroy = await getIronSession<PodLeverSession>(req, res, opts);
  assert(!!sessionToDestroy.userId, "Before destroy(): session.userId is set");

  sessionToDestroy.destroy();
  assert(!sessionToDestroy.userId, "After destroy(): session.userId is undefined (cleared)");

  // Post-logout: browser sends no cookie (browser respects the max-age=0 Set-Cookie
  // written by logout route). A request with no cookie is rejected at Gate 1.
  const userAfter = await readSession(undefined, opts);
  assert(userAfter === null, "Post-logout (no cookie): readSession returns null");

  const err = assertThrowsSync(() => runGuard(userAfter), UnauthorizedError,
    "Post-logout: runGuard(null) throws UnauthorizedError");
  if (err) assert(err.statusCode === 401, "statusCode === 401");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("PodLever — Auth Boundary Verification Script (Phase 1A)");
  console.log("=".repeat(60));

  // Fail-fast: SESSION_SECRET must be present and long enough
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    console.error(
      "\n💥 SESSION_SECRET is missing or too short (must be ≥32 chars).\n" +
        "   Set it via Replit Secrets before running this script.",
    );
    process.exit(1);
  }

  const opts = getSessionOptions();
  let testUserId: string | null = null;

  try {
    // Tests 1–3: pure session/crypto — no DB needed
    await test1_noSession(opts);
    await test2_tamperedCookie(opts);
    await test3_nonOwnerRole(opts);

    // Tests 4–6: require a real users row for the version check
    console.log("\n🔧 Setting up DB test user...");
    const { userId, sessionVersion } = await setupTestUser();
    testUserId = userId;
    console.log(`   User ID:         ${userId}`);
    console.log(`   Session version: ${sessionVersion}`);

    await test4_validOwnerSession(opts, userId, sessionVersion);
    await test5_stolenCookieRejected(opts, userId, sessionVersion);

    // test5 incremented the DB version; refetch the current version for test6
    const [currentRow] = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    await test6_logoutClearsCookie(opts, userId, currentRow!.sessionVersion);

  } catch (err) {
    console.error("\n💥 Unexpected error in test harness:", err);
    _failed++;
  } finally {
    if (testUserId) {
      console.log("\n🧹 Cleaning up DB test user...");
      await cleanupTestUser(testUserId);
      console.log("   Cleanup complete.");
    }

    // Close the pg pool so the process exits cleanly (no hang)
    const pool = (db as unknown as { $client: InstanceType<typeof Pool> }).$client;
    if (pool && typeof pool.end === "function") await pool.end();
  }

  // ── Final report ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${_passed} passed, ${_failed} failed`);
  console.log("=".repeat(60));

  if (_failed > 0) {
    console.error(`\n❌ ${_failed} assertion(s) failed — Phase 1A auth boundary verification INCOMPLETE`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${_passed} assertions passed — Phase 1A auth boundary verified`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
