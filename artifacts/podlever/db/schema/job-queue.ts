/**
 * db/schema/job-queue.ts — Persistent job queue for background processing
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Week-1 ops: replace after() with DB queue)
 *
 * Replaces Next.js after() fire-and-forget with a durable DB-backed queue.
 * Worker uses SELECT … FOR UPDATE SKIP LOCKED for atomic job claiming.
 *
 * Status lifecycle:
 *   pending → running → completed
 *                    ↘ failed (attempts >= max_attempts)
 *                    ↘ retrying (attempts < max_attempts, run_at = future)
 *
 * HUMAN REVIEW NOTES:
 * - No message broker required — polling the DB every N seconds is sufficient
 *   for PodLever's volume (< 100 episodes/day in beta).
 * - The partial index on (status, run_at) makes the worker claim query fast
 *   even with thousands of completed rows.
 * - payload is jsonb — callers must define their own payload schemas.
 */

import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// ─── Valid status values ──────────────────────────────────────────────────────

export const JOB_STATUSES = ["pending", "running", "completed", "failed", "retrying"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = ["process_episode"] as const;
export type JobType = (typeof JOB_TYPES)[number];

// ─── Table ────────────────────────────────────────────────────────────────────

export const jobQueue = pgTable("job_queue", {
  /** Surrogate PK. */
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * Discriminator for the worker to dispatch to the right handler.
   * Currently only "process_episode".
   */
  jobType: text("job_type").notNull(),

  /**
   * JSON payload — shape determined by jobType.
   * process_episode: { episodeId: string, ownerId: string }
   */
  payload: jsonb("payload").notNull(),

  /**
   * Current processing status.
   * Worker uses FOR UPDATE SKIP LOCKED on pending/retrying rows.
   */
  status: text("status").notNull().default("pending"),

  /** Higher priority = claimed first. Default 0. */
  priority: integer("priority").notNull().default(0),

  /** How many times this job has been attempted (including current if running). */
  attempts: integer("attempts").notNull().default(0),

  /** Maximum retries before the job is marked failed permanently. */
  maxAttempts: integer("max_attempts").notNull().default(3),

  /** Last error message (for debugging stalled/failed jobs). */
  lastError: text("last_error"),

  /**
   * Earliest time the job should be claimed by a worker.
   * Set to now() for immediate jobs; set to future for retries (backoff).
   */
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),

  /** Timestamp when a worker last claimed this job. */
  startedAt: timestamp("started_at", { withTimezone: true }),

  /** Timestamp when the job reached completed or failed state. */
  completedAt: timestamp("completed_at", { withTimezone: true }),

  /** Row insertion timestamp. */
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Job    = typeof jobQueue.$inferSelect;
export type NewJob = typeof jobQueue.$inferInsert;
