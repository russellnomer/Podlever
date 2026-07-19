/**
 * app/dashboard/episodes/[id]/page.tsx — Episode detail page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #2 — Episode processing pipeline)
 *
 * Route: /dashboard/episodes/[id] (owner-only)
 *
 * Server Component. Shows episode status and, once ready, all generated assets
 * as copyable text panels. Includes StatusPoller which auto-refreshes while
 * the episode is in "processing" state.
 *
 * Assets displayed (in order):
 *   transcript, show_notes, blog_post, social_post, guest_media_pack
 *   cleaned_audio — audio download link via signed GCS URL
 */

import { redirect, notFound }      from "next/navigation";
import Link                        from "next/link";
import { getAuthUser }             from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import { episodeRepository, assetRepository } from "@/repositories";
import { getSignedDownloadUrl }    from "@/lib/storage";
import { StatusPoller }            from "../components/StatusPoller";
import {
  ArrowLeft, CheckCircle2, Clock, Radio,
  Download, Copy, FileText, BookOpen,
  Share2, Gift, Mic2,
} from "lucide-react";
import type { Asset, AssetType } from "@/db/schema";

// ─── Asset display config ─────────────────────────────────────────────────────

const ASSET_CONFIG: Partial<Record<AssetType, {
  label:   string;
  icon:    React.ComponentType<{ className?: string }>;
  rows:    number;
  monospace?: boolean;
}>> = {
  transcript:      { label: "Transcript",       icon: FileText,  rows: 20 },
  show_notes:      { label: "Show Notes",        icon: BookOpen,  rows: 14 },
  blog_post:       { label: "Blog Post",         icon: BookOpen,  rows: 18 },
  social_post:     { label: "Social Copy",       icon: Share2,    rows: 12 },
  guest_media_pack:{ label: "Guest Media Pack",  icon: Gift,      rows: 14 },
};

// ─── Copy button (client-side interaction) ────────────────────────────────────

// Inline since it's tiny — avoids an extra client component file.
function AssetPanel({ asset }: { asset: Asset }) {
  const cfg = ASSET_CONFIG[asset.assetType as AssetType];
  if (!cfg || !asset.content) return null;
  const Icon = cfg.icon;

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-800">{cfg.label}</h3>
        </div>
        {/* Copy button — client-side via form + native clipboard API */}
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(asset.content ?? "");
          }}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium
                     text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <Copy className="w-3 h-3" />
          Copy
        </button>
      </header>
      <textarea
        readOnly
        value={asset.content}
        rows={cfg.rows}
        className="w-full resize-y p-4 text-sm text-gray-700 leading-relaxed
                   font-mono bg-white focus:outline-none"
      />
    </section>
  );
}

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EpisodeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: episodeId } = await params;

  // Auth guard
  const session = await getAuthUser();
  let ownerId: string;
  try {
    const identity = await requireOwnerFromSession(session);
    ownerId = identity.userId;
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

  // Fetch assets + audio download URL in parallel
  const [allAssets, audioUrl] = await Promise.all([
    assetRepository.listAssetsForEpisode(episodeId),
    episode.audioStorageKey
      ? getSignedDownloadUrl(episode.audioStorageKey).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Latest version of each text asset type (ordered by the repository: type ASC, version DESC)
  const latestByType = new Map<string, Asset>();
  for (const asset of allAssets) {
    if (!latestByType.has(asset.assetType)) {
      latestByType.set(asset.assetType, asset);
    }
  }

  const displayOrder: AssetType[] = [
    "transcript", "show_notes", "blog_post", "social_post", "guest_media_pack",
  ];

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
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
              <Mic2 className="w-6 h-6 text-indigo-500" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 leading-snug">{episode.title}</h1>
              <p className="text-sm text-gray-400 mt-0.5">Uploaded {created}</p>
            </div>
          </div>
          <StateBadge state={episode.state} />
        </div>

        {/* Status poller — visible + active only while processing */}
        <StatusPoller state={episode.state} />

        {/* Stalled state — processing for a long time without assets */}
        {episode.state === "processing" && allAssets.length === 0 && (
          <p className="text-center text-sm text-gray-400">
            Assets will appear here as they are generated.
          </p>
        )}

        {/* Audio download */}
        {audioUrl && (
          <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4">
            <div className="flex items-center gap-3">
              <Mic2 className="w-5 h-5 text-indigo-400" />
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

        {/* Generated asset panels */}
        {displayOrder.map((assetType) => {
          const asset = latestByType.get(assetType);
          if (!asset) return null;
          return <AssetPanel key={assetType} asset={asset} />;
        })}

        {/* No assets yet + not processing */}
        {allAssets.length === 0 && episode.state !== "processing" && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-12 text-center">
            <p className="text-sm text-gray-500">No assets generated yet.</p>
          </div>
        )}
      </main>
    </div>
  );
}
