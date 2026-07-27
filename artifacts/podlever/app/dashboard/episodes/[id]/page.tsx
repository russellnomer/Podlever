/**
 * app/dashboard/episodes/[id]/page.tsx — Episode detail page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — close product/promise gap)
 *
 * Route: /dashboard/episodes/[id] (owner-only, Server Component)
 *
 * New in this revision:
 *   - ZIP download button (all assets in one click)
 *   - Guest media pack PDF download button
 *   - Share button (generate public link)
 *   - Regenerate button per text asset (Pro+ plans)
 *   - Cleaned audio download row (if audio enhancement ran)
 *   - Episode COGS summary (total AI cost)
 */

import { redirect, notFound }      from "next/navigation";
import Link                        from "next/link";
import { getAuthUser }         from "@/providers/auth";
import { requireBetaAccess }   from "@/providers/owner-guard";
import { episodeRepository, assetRepository } from "@/repositories";
import { getSignedDownloadUrl }    from "@/lib/storage";
import { ProcessingStepper }       from "../components/ProcessingStepper";
import { after }                    from "next/server";
import { AssetPanel }              from "./components/AssetPanel";
import { ShareButton }             from "./components/ShareButton";
import {
  ArrowLeft, CheckCircle2, Clock, Radio,
  Download, Mic2, Archive, Sparkles, DollarSign,
} from "lucide-react";
import type { Asset, AssetType } from "@/db/schema";

// ─── Asset display config ─────────────────────────────────────────────────────

const ASSET_TYPES_ORDERED: AssetType[] = [
  "transcript", "show_notes", "blog_post", "social_post", "guest_media_pack",
];

const REGEN_ALLOWED_PLANS = new Set(["pro", "agency"]);

// ─── State badge ──────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  if (state === "ready" || state === "published") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Ready
      </span>
    );
  }
  if (state === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
        <Radio className="w-3.5 h-3.5 animate-pulse" />
        Processing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
      <Clock className="w-3.5 h-3.5" />
      {state.charAt(0).toUpperCase() + state.slice(1)}
    </span>
  );
}

// ─── COGS badge ───────────────────────────────────────────────────────────────

async function CogsBadge({ episodeId }: { episodeId: string }) {
  try {
    const { getEpisodeCogs } = await import("@/lib/cogs");
    const summary = await getEpisodeCogs(episodeId);
    if (summary.totalUsd === 0) return null;

    return (
      <span
        className="flex items-center gap-1 text-xs text-gray-400"
        title={`AI processing cost for this episode: $${summary.totalUsd.toFixed(4)}`}
      >
        <DollarSign className="w-3 h-3" />
        {`$${summary.totalUsd.toFixed(4)} AI cost`}
      </span>
    );
  } catch {
    return null; // non-fatal
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EpisodeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: episodeId } = await params;

  // Auth guard — allows owners AND active beta users; episodes are scoped to userId
  const session = await getAuthUser();
  let ownerId: string;
  let plan: string | null = null;
  try {
    const identity = await requireBetaAccess(session);
    ownerId = identity.userId;  // used to scope the episode query to this user only
    plan    = identity.plan ?? null;
  } catch {
    redirect("/auth/login");
  }

  // Fetch episode (owner-scoped)
  let episode;
  try {
    episode = await episodeRepository.getEpisodeForOwner(episodeId, ownerId);
  } catch {
    notFound();
  }

  // Pipeline visibility: where is this episode on the assembly line?
  let queuePosition = 0;
  let aheadTitles: string[] = [];
  // Dead-end detection: episode says "processing" but NO active job exists
  // (job failed permanently after max retries, or the row is gone). Without
  // this, the stepper shows "Queued…" forever with no Retry button — exactly
  // what happened on 2026-07-26 when jobs burned all attempts during the
  // schema-drift window before processing_error could even be recorded.
  let jobStalled = false;
  let jobDetail: string | null = null;
  if (episode.state === "processing") {
    try {
      const { getProcessQueue, getLatestJobForEpisode, hasClaimableJob, kickWorker } =
        await import("@/lib/job-queue");
      const queue = await getProcessQueue();
      const idx   = queue.findIndex((q) => q.episodeId === episodeId);
      // A "processing" episode with no ACTIVE job is a dead end: its job either
      // failed permanently (max retries) or vanished. Nothing will ever pick it
      // up again, so the owner must see a Retry/Cancel path — not "Queued…".
      const job  = await getLatestJobForEpisode(episodeId);
      jobStalled = !job || !["pending", "running", "retrying"].includes(job.status);
      if (jobStalled && job) {
        jobDetail = `Attempt ${job.attempts}/${job.maxAttempts}${job.lastError ? ` — last error: ${job.lastError}` : ""}`;
      }
      if (idx > 0) {
        queuePosition = idx;
        const ahead = queue.slice(0, idx);
        const titles = await Promise.all(
          ahead.map((q) => episodeRepository.getEpisodeById(q.episodeId).then((e) => e.title).catch(() => null)),
        );
        aheadTitles = titles.filter((t): t is string => !!t);
      }
      // Self-heal: Autoscale throttles CPU after responses, so the fire-and-
      // forget worker trigger can be lost. While the owner watches this page
      // (it polls every 5s), re-kick the worker whenever a job is claimable.
      if (await hasClaimableJob()) {
        after(async () => { await kickWorker(); });
      }
    } catch (err) {
      console.warn(JSON.stringify({ event: "episode.queue.snapshot_failed", error: String(err) }));
    }
  }

  // Fetch assets + audio URLs in parallel
  const [allAssets, audioUrl, cleanedAudioUrl] = await Promise.all([
    assetRepository.listAssetsForEpisode(episodeId),
    episode.audioStorageKey
      ? getSignedDownloadUrl(episode.audioStorageKey).catch(() => null)
      : Promise.resolve(null),
    (episode as { cleanedAudioStorageKey?: string | null }).cleanedAudioStorageKey
      ? getSignedDownloadUrl((episode as { cleanedAudioStorageKey: string }).cleanedAudioStorageKey).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Latest version of each text asset type
  const latestByType = new Map<string, Asset>();
  for (const asset of allAssets) {
    if (!latestByType.has(asset.assetType)) {
      latestByType.set(asset.assetType, asset);
    }
  }

  const isReady  = episode.state === "ready" || episode.state === "published";
  const canRegen = REGEN_ALLOWED_PLANS.has(plan ?? "free");
  const guestPack   = latestByType.get("guest_media_pack");
  const showPdfBtn  = isReady && !!guestPack?.content;

  const created = new Date(episode.createdAt).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center gap-4">
          <Link
            href="/dashboard/episodes"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            All episodes
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-800 truncate max-w-xs">{episode.title}</span>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Episode meta card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                <Mic2 className="w-6 h-6 text-indigo-500" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900 leading-snug">{episode.title}</h1>
                <p className="text-sm text-gray-400 mt-0.5">Uploaded {created}</p>
                {/* COGS badge — async server component */}
                        <CogsBadge episodeId={episodeId} />
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <StateBadge state={episode.state} />
              {/* ZIP download — all assets in one click */}
              {isReady && (
                <a
                  href={`/api/episodes/${episodeId}/zip`}
                  download
                  className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium
                             text-gray-700 hover:bg-gray-200 transition-colors"
                  title="Download all assets as ZIP"
                >
                  <Archive className="w-4 h-4" />
                  Download all
                </a>
              )}
            </div>
          </div>

          {/* Share row */}
          {isReady && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3 flex-wrap">
              <span className="text-xs text-gray-500">Public link:</span>
              <ShareButton
                episodeId={episodeId}
                initialShareToken={(episode as { shareToken?: string | null }).shareToken ?? null}
              />
            </div>
          )}
        </div>

        {/* Status poller — visible + active only while processing */}
        <ProcessingStepper
          episodeId={episode.id}
          state={episode.state}
          stage={(episode as { processingStage?: string | null }).processingStage ?? null}
          error={
            (episode as { processingError?: string | null }).processingError ??
            (jobStalled
              ? `Processing stopped unexpectedly and will not resume on its own.${jobDetail ? ` (${jobDetail})` : ""} Press Retry now to start it fresh, or Cancel & delete to remove this episode.`
              : null)
          }
          queuePosition={queuePosition}
          aheadTitles={aheadTitles}
        />

        {/* Processing placeholder */}
        {episode.state === "processing" && allAssets.length === 0 && (
          <p className="text-center text-sm text-gray-400">
            Assets will appear here as they are generated.
          </p>
        )}

        {/* Audio rows */}
        {(audioUrl || cleanedAudioUrl) && (
          <div className="space-y-2">
            {/* Cleaned audio (enhanced) — shown first if available */}
            {cleanedAudioUrl && (
              <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/30 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Enhanced audio</p>
                    <p className="text-xs text-gray-400">Noise-reduced · loudness normalized</p>
                  </div>
                </div>
                <a
                  href={cleanedAudioUrl}
                  download
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
              </div>
            )}

            {/* Original audio */}
            {audioUrl && (
              <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4">
                <div className="flex items-center gap-3">
                  <Mic2 className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Original audio</p>
                    <p className="text-xs text-gray-400">Signed link valid for 15 minutes</p>
                  </div>
                </div>
                <a
                  href={audioUrl}
                  download
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
              </div>
            )}
          </div>
        )}

        {/* Generated asset panels */}
        {ASSET_TYPES_ORDERED.map((assetType) => {
          const asset = latestByType.get(assetType);
          if (!asset?.content) return null;
          return (
            <AssetPanel
              key={assetType}
              episodeId={episodeId}
              assetType={assetType}
              content={asset.content}
              canRegen={canRegen}
              showPdfButton={assetType === "guest_media_pack" && showPdfBtn}
            />
          );
        })}

        {/* No assets yet + not processing */}
        {allAssets.filter((a) => ASSET_TYPES_ORDERED.includes(a.assetType as AssetType)).length === 0
          && episode.state !== "processing" && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-12 text-center">
            <p className="text-sm text-gray-500">No assets generated yet.</p>
          </div>
        )}

        {/* Regeneration hint for Free plan */}
        {isReady && !canRegen && (
          <p className="text-center text-xs text-gray-400">
            <Link href="/dashboard/billing" className="text-indigo-500 hover:underline">
              Upgrade to Pro
            </Link>
            {" "}to regenerate assets with revised tone or style.
          </p>
        )}
      </main>
    </div>
  );
}
