/**
 * lib/rate-limiter.ts — In-memory per-IP sliding-window rate limiter
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (Task #7 — login flood protection)
 *
 * HUMAN REVIEW NOTES:
 * This module provides a lightweight, zero-dependency sliding-window rate limiter
 * backed by an in-process Map. It is intentionally simple: single-instance only,
 * state does not survive process restarts. Both properties are acceptable for
 * Phase 1B (single Replit instance). If PodLever ever scales horizontally, swap
 * the store for Redis (e.g., upstash/ratelimit) without changing the call site.
 *
 * Design:
 *   - One Map<string, number[]> keyed by IP address.
 *   - Each entry holds an array of Unix-millisecond timestamps for recent hits.
 *   - On every check, timestamps older than `windowMs` are pruned first (sliding window).
 *   - If remaining slots > 0, the timestamp is appended and the request is allowed.
 *   - Stale entries (IPs with zero recent hits) are cleaned up via a lazy sweep
 *     triggered every CLEANUP_INTERVAL_MS to prevent unbounded Map growth.
 *
 * Security:
 *   - IP extraction prefers `x-forwarded-for` (Replit proxy) then falls back to
 *     a static sentinel string so the limiter never silently skips checking.
 *   - The sentinel means a missing-IP request still consumes rate-limit budget.
 *
 * Usage:
 *   const limiter = new SlidingWindowRateLimiter({ max: 10, windowMs: 60_000 });
 *   const result  = limiter.check(ip);
 *   if (!result.allowed) { return 429; }
 */

/** Options for SlidingWindowRateLimiter */
export interface RateLimiterOptions {
  /**
   * Maximum number of requests allowed within the window.
   * For `/auth/login`, 10 requests/minute is the Phase 1B baseline.
   */
  max: number;

  /**
   * Length of the sliding window in milliseconds.
   * Requests older than this are not counted toward the limit.
   */
  windowMs: number;
}

/** Result returned by SlidingWindowRateLimiter.check() */
export interface RateLimitResult {
  /** true if the request is within the limit and should proceed */
  allowed: boolean;

  /** Number of remaining requests in the current window */
  remaining: number;

  /**
   * Unix timestamp (ms) at which the oldest in-window request expires.
   * Useful for building a Retry-After header.
   */
  resetAt: number;
}

/** How often (ms) to sweep the internal Map for fully-expired IPs */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * SlidingWindowRateLimiter — per-key in-memory rate limiter.
 *
 * Instantiate once per protected route (module-level singleton).
 * Thread-safe for Node.js single-threaded event loop; no locking needed.
 */
export class SlidingWindowRateLimiter {
  private readonly max: number;
  private readonly windowMs: number;

  /**
   * Internal store: Map from IP string → array of hit timestamps (ms).
   * Timestamps are always sorted ascending; pruning removes from the front.
   */
  private readonly store = new Map<string, number[]>();

  /** Timer handle for the periodic stale-entry cleanup sweep */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: RateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;

    // Schedule periodic cleanup so stale IPs don't accumulate indefinitely.
    // unref() prevents this timer from keeping the Node.js process alive after
    // all other work is done (important for test environments / graceful shutdown).
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * check — Evaluate and record a request hit for the given key.
   *
   * @param key  Per-requester identifier — typically the client IP address.
   * @returns    RateLimitResult with allowed flag, remaining slots, and reset time.
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Retrieve existing timestamps for this key, or start fresh.
    let hits = this.store.get(key) ?? [];

    // Prune hits that have fallen outside the sliding window.
    hits = hits.filter((ts) => ts > windowStart);

    const remaining = this.max - hits.length;
    const allowed = remaining > 0;

    if (allowed) {
      // Record this hit and persist the updated list.
      hits.push(now);
      this.store.set(key, hits);
    }

    // resetAt is when the oldest in-window hit will expire.
    // If there are no hits (e.g., first request), reset is now+windowMs.
    const resetAt = hits.length > 0 ? hits[0] + this.windowMs : now + this.windowMs;

    return {
      allowed,
      remaining: Math.max(0, remaining - (allowed ? 1 : 0)),
      resetAt,
    };
  }

  /**
   * peek — Return rate limit state for a key WITHOUT recording a hit.
   *
   * Used to show the remaining export count in the UI without consuming budget.
   * Does NOT mutate the store — safe to call at any time.
   *
   * @param key  Per-requester identifier (IP or session userId).
   * @returns    RateLimitResult with the current state (no hit recorded).
   */
  peek(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const hits = (this.store.get(key) ?? []).filter((ts) => ts > windowStart);
    const remaining = Math.max(0, this.max - hits.length);
    const resetAt = hits.length > 0 ? hits[0] + this.windowMs : now + this.windowMs;

    return {
      allowed: remaining > 0,
      remaining,
      resetAt,
    };
  }

  /**
   * cleanup — Remove Map entries whose all timestamps are outside the window.
   *
   * Called on a timer; also exposed for testing convenience.
   */
  cleanup(): void {
    const windowStart = Date.now() - this.windowMs;

    for (const [key, hits] of this.store.entries()) {
      // If no hits remain within the window, the entry is fully stale — remove it.
      if (hits.every((ts) => ts <= windowStart)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * extractIp — Pull the client IP from Next.js request headers.
   *
   * Replit's reverse proxy injects the real client IP in x-forwarded-for.
   * Falls back to a sentinel so the limiter never silently bypasses itself.
   *
   * @param headers  The Headers object from the incoming NextRequest.
   * @returns        IP string suitable for use as a rate-limiter key.
   */
  static extractIp(headers: Headers): string {
    // x-forwarded-for may contain a comma-separated list; take the first entry.
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0].trim();
      if (first) return first;
    }

    // Fallback: x-real-ip (some proxy configs set this instead)
    const realIp = headers.get("x-real-ip");
    if (realIp) return realIp.trim();

    // Final sentinel: unknown IP still consumes budget — never silently skip.
    return "unknown";
  }
}
