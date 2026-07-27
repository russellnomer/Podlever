/**
 * app/rpc/queue/worker/route.ts — Job queue worker endpoint
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Week-1 ops — persistent queue)
 *
 * Route: POST /rpc/queue/worker
 *
 * Claims and processes ONE pending job from the job_queue table.
 * Designed to be called by:
 *   - after() immediately after a job is enqueued (fast trigger)
 *   - The prune-rate-limits cron (as a second call to pick up stale jobs)
 *   - Future: external scheduler hitting this endpoint on an interval
 *
 * Auth: CRON_SECRET bearer token.
 * Returns 204 if no jobs are pending, 200 on completion, 500 on failure.
 *
 * Retry semantics: on failure, failJob() schedules the next attempt with
 * exponential backoff. The next trigger will claim it when run_at arrives.
 *
 * Recovery: if the worker crashes while a job is "running" (status stuck),
 * the stale-job recovery GET endpoint resets it to "retrying".
 *
 * SECURITY: server-only, CRON_SECRET auth — never callable from browser.
 */

import { type NextRequest, NextResponse } from "next/server";
import { claimNextJob, completeJob, failJob, hasClaimableJob, kickWorker } from "@/lib/job-queue";
import { after } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";

// ─── Auth ──────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  // Constant-time, header-only (Security sprint PR #22).
  return isCronAuthorized(req.headers.get("authorization"));
}

// ─── Job handlers ──────────────────────────────────────────────────────────────

/**
 * handleProcessEpisode — Delegate to the dedicated process route.
 *
 * The process route is the authoritative pipeline handler. The worker
 * acts as an orchestrator: claim → trigger → mark result.
 */
async function handleProcessEpisode(payload: Record<string, unknown>): Promise<void> {
  const episodeId = payload["episodeId"] as string | undefined;
  if (!episodeId) throw new Error("process_episode job missing episodeId in payload");

  const port       = process.env.PORT ?? "3000";
  const processUrl = `http://localhost:${port}/rpc/episodes/${episodeId}/process`;
  const secret     = process.env.CRON_SECRET ?? "";

  const res = await fetch(processUrl, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Content-Type":  "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Process route returned ${res.status}: ${body.slice(0, 300)}`);
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Claim a job atomically — returns null if nothing is pending
  const job = await claimNextJob();

  if (!job) {
    return new NextResponse(null, { status: 204 }); // no jobs pending
  }

  console.log(JSON.stringify({
    event:    "worker.job_claimed",
    jobId:    job.id,
    jobType:  job.jobType,
    attempt:  job.attempts,
  }));

  try {
    switch (job.jobType) {
      case "process_episode":
        await handleProcessEpisode(job.payload as Record<string, unknown>);
        break;
      default:
        throw new Error(`Unknown job type: ${job.jobType}`);
    }

    await completeJob(job.id);

    // Chain: if more jobs are waiting in line, trigger the next cycle so the
    // queue drains without waiting for another external kick.
    if (await hasClaimableJob()) {
      after(async () => { await kickWorker(); });
    }

    console.log(JSON.stringify({ event: "worker.job_complete", jobId: job.id }));
    return NextResponse.json({ ok: true, jobId: job.id, jobType: job.jobType });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await failJob(job.id, message);

    // If this was the final attempt, surface the failure on the episode row —
    // otherwise the UI shows an eternal spinner with no explanation.
    if (job.jobType === "process_episode" && job.attempts >= job.maxAttempts) {
      const episodeId = (job.payload as Record<string, unknown>)["episodeId"] as string | undefined;
      if (episodeId) {
        const { episodeRepository } = await import("@/repositories");
        await episodeRepository.setProcessingError(
          episodeId,
          `Processing failed after ${job.attempts} attempts: ${message.slice(0, 400)}`,
        );
      }
    }

    console.error(JSON.stringify({
      event:   "worker.job_failed",
      jobId:   job.id,
      jobType: job.jobType,
      attempt: job.attempts,
      error:   message,
    }));

    return NextResponse.json({ error: "Job failed", jobId: job.id }, { status: 500 });
  }
}

// ─── Stale job recovery ────────────────────────────────────────────────────────

/**
 * GET /rpc/queue/worker — Reset "running" jobs stuck for > 10 minutes.
 *
 * Called by the existing cron infrastructure alongside prune-rate-limits.
 * A job stuck in "running" means the worker crashed mid-execution.
 * Reset to "retrying" so the next worker trigger picks it up.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Import here to avoid circular deps at module load time
  const { db }       = await import("@/db");
  const { jobQueue } = await import("@/db/schema/job-queue");
  const { sql }      = await import("drizzle-orm");

  // Reset jobs that have been "running" for more than 10 minutes
  const result = await db.execute(sql`
    UPDATE job_queue
    SET status    = 'retrying',
        last_error = 'Worker crashed or timed out — auto-recovered by stale-job cron',
        run_at    = now() + INTERVAL '30 seconds'
    WHERE status = 'running'
      AND started_at < now() - INTERVAL '10 minutes'
    RETURNING id
  `);

  const recovered = result.rows.length;

  if (recovered > 0) {
    console.log(JSON.stringify({ event: "worker.stale_jobs_recovered", count: recovered }));
  }

  return NextResponse.json({ recovered });
}
