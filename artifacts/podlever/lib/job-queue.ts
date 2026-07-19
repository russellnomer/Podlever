/**
 * lib/job-queue.ts — DB-backed persistent job queue
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Week-1 ops — replace after() with durable queue)
 *
 * Design: PostgreSQL-backed queue using SELECT … FOR UPDATE SKIP LOCKED for
 * atomic job claiming. No Redis, no external broker — works within Replit's
 * managed Postgres instance.
 *
 * Worker flow:
 *   1. claimNextJob() — atomically grabs one pending/retrying job
 *   2. Execute the job handler
 *   3. completeJob() or failJob()
 *
 * Retry strategy: exponential backoff — 30s, 5m, 30m gaps between attempts.
 *
 * HUMAN REVIEW NOTES:
 * - All DB operations are within the same pool as the app — no separate connection.
 * - claimNextJob uses a CTE with FOR UPDATE SKIP LOCKED — concurrent workers
 *   cannot claim the same job. Safe for multiple worker instances.
 * - This is sufficient for < 1,000 jobs/day. Add BullMQ/Temporal when volume grows.
 */

import "server-only";
import { db }       from "@/db";
import { jobQueue } from "@/db/schema/job-queue";
import { and, eq, lte, or, sql } from "drizzle-orm";
import type { Job, NewJob, JobType } from "@/db/schema/job-queue";

// ─── Retry backoff ────────────────────────────────────────────────────────────

/** Seconds to wait before retrying on attempt N (1-indexed). */
const BACKOFF_SECONDS = [30, 5 * 60, 30 * 60]; // 30s, 5min, 30min

function retryDelaySeconds(attempt: number): number {
  return BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)] ?? 30 * 60;
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * enqueueJob — Insert a job into the queue for immediate or scheduled execution.
 *
 * @param jobType  Job type discriminator (must be in JOB_TYPES)
 * @param payload  Arbitrary JSON payload for the handler
 * @param options  Optional priority (higher = claimed first) and runAt override
 * @returns        The newly created job row
 */
export async function enqueueJob(
  jobType:  JobType,
  payload:  Record<string, unknown>,
  options?: { priority?: number; runAt?: Date },
): Promise<Job> {
  const [job] = await db
    .insert(jobQueue)
    .values({
      jobType,
      payload,
      priority: options?.priority ?? 0,
      runAt:    options?.runAt ?? new Date(),
    } satisfies Omit<NewJob, "id" | "createdAt" | "status" | "attempts" | "maxAttempts">)
    .returning();

  if (!job) throw new Error("Failed to enqueue job");
  return job;
}

// ─── Claim ────────────────────────────────────────────────────────────────────

/**
 * claimNextJob — Atomically claim the highest-priority claimable job.
 *
 * Uses a CTE with FOR UPDATE SKIP LOCKED so concurrent workers never
 * claim the same row. Returns null if no jobs are ready.
 *
 * Increments attempts and sets status = 'running', started_at = now().
 */
export async function claimNextJob(): Promise<Job | null> {
  // Raw SQL needed for the SKIP LOCKED clause which Drizzle doesn't expose.
  const rows = await db.execute<Job>(sql`
    WITH claimed AS (
      SELECT id FROM job_queue
      WHERE  status IN ('pending', 'retrying')
      AND    run_at  <= now()
      ORDER  BY priority DESC, run_at ASC
      LIMIT  1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE job_queue
    SET    status     = 'running',
           attempts   = attempts + 1,
           started_at = now()
    FROM   claimed
    WHERE  job_queue.id = claimed.id
    RETURNING job_queue.*
  `);

  return (rows.rows[0] as Job | undefined) ?? null;
}

// ─── Complete / Fail ──────────────────────────────────────────────────────────

/**
 * completeJob — Mark a running job as successfully completed.
 */
export async function completeJob(jobId: string): Promise<void> {
  await db
    .update(jobQueue)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(jobQueue.id, jobId));
}

/**
 * failJob — Mark a job as failed or schedule a retry with backoff.
 *
 * If attempts < maxAttempts, transitions to "retrying" with run_at = now + backoff.
 * If at limit, transitions to "failed" permanently.
 *
 * @param jobId    UUID of the job
 * @param error    Human-readable error message for debugging
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  const [job] = await db
    .select({ attempts: jobQueue.attempts, maxAttempts: jobQueue.maxAttempts })
    .from(jobQueue)
    .where(eq(jobQueue.id, jobId));

  if (!job) return;

  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    await db
      .update(jobQueue)
      .set({ status: "failed", lastError: error.slice(0, 1000), completedAt: new Date() })
      .where(eq(jobQueue.id, jobId));
  } else {
    const delaySec = retryDelaySeconds(job.attempts);
    const runAt    = new Date(Date.now() + delaySec * 1000);

    await db
      .update(jobQueue)
      .set({ status: "retrying", lastError: error.slice(0, 1000), runAt })
      .where(eq(jobQueue.id, jobId));
  }
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

/** getJobCounts — count jobs by status for the admin dashboard. */
export async function getJobCounts(): Promise<Record<string, number>> {
  const rows = await db.execute<{ status: string; cnt: string }>(sql`
    SELECT status, COUNT(*)::int AS cnt FROM job_queue GROUP BY status
  `);

  const counts: Record<string, number> = {};
  for (const row of rows.rows) {
    counts[row.status] = Number(row.cnt);
  }
  return counts;
}
