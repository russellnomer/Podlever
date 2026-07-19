/**
 * __tests__/prune-rate-limits-auth.test.ts
 * Unit tests for POST /rpc/cron/prune-rate-limits authentication gate
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #48 — verify cron route rejects bad tokens)
 *
 * HUMAN REVIEW NOTES:
 * These are UNIT tests — no real database connection is used.
 * PostgresRateLimitStore.pruneStaleRows() is mocked to resolve immediately.
 *
 * What this proves (OWASP A07 — Identification and Authentication Failures):
 *   - 503 is returned when CRON_SECRET is not set in the environment.
 *   - 401 is returned for any request with a wrong or missing Bearer token.
 *   - 200 is returned (with a { deleted } body) for a correctly authenticated request.
 *
 * The vi.mock() call at the top of this file is hoisted by Vitest's transform
 * before any imports are evaluated, so the mock is always active in this file.
 * It does NOT affect the integration test file (each file runs in its own fork).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB call so no database is needed ───────────────────────────────

/**
 * Replace PostgresRateLimitStore with a stub that records calls but never hits
 * the DB. pruneStaleRows resolves with 0 by default; individual tests can
 * override this if they need a specific deletion count.
 */
vi.mock("@/lib/rate-limit-store", () => ({
  PostgresRateLimitStore: {
    pruneStaleRows: vi.fn().mockResolvedValue(0),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal POST Request for the cron route.
 *
 * @param token  Value appended as "Bearer <token>".
 *               Pass undefined to omit the Authorization header entirely.
 */
function makeCronRequest(token?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request("http://localhost/rpc/cron/prune-rate-limits", {
    method: "POST",
    headers,
  });
}

// ─── Route handler (re-imported after each resetModules) ─────────────────────

let POST: (req: Request) => Promise<Response>;

describe("POST /rpc/cron/prune-rate-limits — authentication", () => {
  /**
   * Re-import the route handler before each test so that process.env.CRON_SECRET
   * is read fresh each time. vi.resetModules() clears the module registry;
   * vi.mock() is re-applied so the DB stub remains active.
   */
  beforeEach(async () => {
    vi.resetModules();
    vi.mock("@/lib/rate-limit-store", () => ({
      PostgresRateLimitStore: {
        pruneStaleRows: vi.fn().mockResolvedValue(0),
      },
    }));
    const mod = await import("@/app/rpc/cron/prune-rate-limits/route");
    POST = mod.POST;
  });

  // ── 503: secret not configured ──────────────────────────────────────────────

  /**
   * When CRON_SECRET is absent the route must refuse all calls (fail-secure).
   * Returning 503 tells the scheduler "this endpoint is not ready" rather than
   * silently accepting requests with no authentication.
   */
  it("returns 503 when CRON_SECRET env var is not set", async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;

    try {
      const res = await POST(makeCronRequest("any-token"));
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe("string");
    } finally {
      if (saved !== undefined) process.env.CRON_SECRET = saved;
    }
  });

  // ── 401: wrong token ─────────────────────────────────────────────────────────

  /**
   * Correct secret in env, but caller sends the wrong value.
   * The route must reject with 401 — not 200 or 500.
   */
  it("returns 401 when an incorrect Bearer token is supplied", async () => {
    process.env.CRON_SECRET = "correct-secret-abc123";
    try {
      const res = await POST(makeCronRequest("wrong-secret-xyz"));
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe("string");
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  /**
   * Token is the correct value but missing the "Bearer " prefix.
   * The route must not accept raw tokens — only the Bearer scheme is valid.
   */
  it("returns 401 when Authorization header lacks the 'Bearer ' prefix", async () => {
    process.env.CRON_SECRET = "correct-secret-abc123";
    try {
      const req = new Request("http://localhost/rpc/cron/prune-rate-limits", {
        method: "POST",
        headers: { Authorization: "correct-secret-abc123" }, // no "Bearer " prefix
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  /**
   * No Authorization header at all (e.g. a browser probe or misconfigured scheduler).
   * Must return 401, not 500 or 200.
   */
  it("returns 401 when the Authorization header is missing entirely", async () => {
    process.env.CRON_SECRET = "correct-secret-abc123";
    try {
      const res = await POST(makeCronRequest(/* no token */));
      expect(res.status).toBe(401);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  // ── 200: correct token ───────────────────────────────────────────────────────

  /**
   * Happy path: CRON_SECRET set, caller supplies the matching Bearer token.
   * Route must return 200 with a JSON body containing a numeric `deleted` field.
   */
  it("returns 200 with { deleted: number } when the correct Bearer token is supplied", async () => {
    process.env.CRON_SECRET = "correct-secret-abc123";
    try {
      const res = await POST(makeCronRequest("correct-secret-abc123"));
      expect(res.status).toBe(200);
      const body = await res.json() as { deleted: number };
      expect(typeof body.deleted).toBe("number");
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
