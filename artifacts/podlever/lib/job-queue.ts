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
  //
  // ⚠️ HARD-LEARNED LESSON (prod incident 2026-07-27, "Unknown job type:
  // undefined"): db.execute() returns RAW PostgreSQL rows with snake_case
  // column names (job_type, max_attempts, …). Casting that to the Drizzle
  // camelCase `Job` type compiles fine but is FALSE at runtime — every
  // multi-word field reads as undefined, so the worker's switch on
  // job.jobType hit the default branch for every job ever claimed.
  //
  // Fix: raw SQL does ONLY what Drizzle can't (SKIP LOCKED claim + status
  // flip), returning just the id. The typed row then comes from a normal
  // Drizzle select, which owns the snake_case→camelCase mapping.
  // NEVER cast a db.execute() row to a Drizzle $inferSelect type.
  const claimed = await db.execute<{ id: string }>(sql`
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
    RETURNING job_queue.id
  `);

  const claimedId = claimed.rows[0]?.id;
  if (!claimedId) return null;

  // Step 2: fetch the claimed row through the ORM for correct camelCase typing.
  const [job] = await db
    .select()
    .from(jobQueue)
    .where(eq(jobQueue.id, claimedId))
    .limit(1);

  return job ?? null;
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

// ─── Pipeline queue visibility + self-healing ─────────────────────────────────

/** One entry in the processing "assembly line" queue, in claim order. */
export interface QueueEntry {
  episodeId: string;
  status:    "pending" | "running" | "retrying" | string;
  runAt:     Date;
  attempts:  number;
  lastError: string | null;
}

/**
 * getProcessQueue — All in-flight process_episode jobs in the order the
 * worker will claim them (running first, then by priority/run_at/created_at).
 * Powers the assembly-line queue view ("The Grove is #2 in line").
 */
export async function getProcessQueue(): Promise<QueueEntry[]> {
  const rows = await db.execute<{
    episode_id: string; status: string; run_at: Date | string;
    attempts: number; last_error: string | null;
  }>(sql`
    SELECT payload->>'episodeId' AS episode_id, status, run_at, attempts, last_error
    FROM job_queue
    WHERE job_type = 'process_episode'
      AND status IN ('pending', 'running', 'retrying')
    ORDER BY (status = 'running') DESC, priority DESC, run_at ASC, created_at ASC
  `);
  return rows.rows
    .filter((r) => !!r.episode_id)
    .map((r) => ({
      episodeId: r.episode_id,
      status:    r.status,
      runAt:     new Date(r.run_at),
      attempts:  Number(r.attempts),
      lastError: r.last_error,
    }));
}

/**
 * hasClaimableJob — Is at least one process_episode job ready to run now?
 * Used by the episode page to self-heal: Autoscale deployments throttle CPU
 * after a response is sent, so the after() worker trigger can be lost. While
 * someone is watching a processing episode, the page re-kicks the worker.
 */
export async function hasClaimableJob(): Promise<boolean> {
  const rows = await db.execute<{ one: number }>(sql`
    SELECT 1 AS one FROM job_queue
    WHERE job_type = 'process_episode'
      AND (status = 'pending' OR status = 'retrying')
      AND run_at <= now()
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

/**
 * kickWorker — Fire one worker cycle via the internal RPC endpoint.
 * Best-effort and non-blocking for callers that don't await it.
 */
export async function kickWorker(): Promise<void> {
  const port   = process.env.PORT ?? "3000";
  const secret = process.env.CRON_SECRET ?? "";
  try {
    await fetch(`http://localhost:${port}/rpc/queue/worker`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "worker.kick_failed", error: String(err) }));
  }
}

/**
 * expediteEpisodeJob — Pull an episode's queued/retrying job forward to run
 * immediately (used by the owner's Retry button so a 30-minute backoff never
 * blocks an actively-watched episode). Returns true if a job was found.
 */
export async function expediteEpisodeJob(episodeId: string): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE job_queue
    SET run_at = now(), status = 'pending'
    WHERE job_type = 'process_episode'
      AND payload->>'episodeId' = ${episodeId}
      AND status IN ('pending', 'retrying')
    RETURNING id
  `);
  return rows.rows.length > 0;
}

/**
 * getLatestJobForEpisode — Most recent job row for an episode, ANY status.
 *
 * Unlike getProcessQueue (active jobs only), this also returns permanently
 * failed jobs — needed by the episode page to distinguish "in line" from
 * "dead and needs owner action" and to surface last_error for troubleshooting.
 */
export async function getLatestJobForEpisode(episodeId: string): Promise<{
  status: string; attempts: number; maxAttempts: number;
  lastError: string | null; runAt: Date;
} | null> {
  const rows = await db.execute<{
    status: string; attempts: number; max_attempts: number;
    last_error: string | null; run_at: Date | string;
  }>(sql`
    SELECT status, attempts, max_attempts, last_error, run_at
    FROM job_queue
    WHERE job_type = 'process_episode'
      AND payload->>'episodeId' = ${episodeId}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const r = rows.rows[0];
  if (!r) return null;
  return {
    status:      r.status,
    attempts:    Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    lastError:   r.last_error,
    runAt:       new Date(r.run_at),
  };
}

/**
 * cancelJobsForEpisode — Mark all active jobs for an episode as failed with a
 * "Cancelled by owner" note so the worker will never pick them up again.
 * Used by the owner's Cancel & delete flow. Returns number of jobs cancelled.
 */
export async function cancelJobsForEpisode(episodeId: string): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE job_queue
    SET status = 'failed',
        last_error = 'Cancelled by owner',
        attempts = max_attempts
    WHERE job_type = 'process_episode'
      AND payload->>'episodeId' = ${episodeId}
      AND status IN ('pending', 'running', 'retrying')
    RETURNING id
  `);
  return rows.rows.length;
}
