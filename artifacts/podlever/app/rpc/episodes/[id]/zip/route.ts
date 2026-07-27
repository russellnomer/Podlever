/**
 * app/rpc/episodes/[id]/zip/route.ts — Bulk ZIP download for all episode assets
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — ZIP bulk export)
 *
 * Route: GET /rpc/episodes/[id]/zip
 *
 * Packages all text assets + audio into a downloadable ZIP.
 * Streams the response as application/zip with a Content-Disposition header.
 *
 * Auth: iron-session. Owner-only.
 * Rate: no explicit rate limit — each call fetches audio from GCS so it is
 *       naturally self-throttling (slow to respond for large files).
 *
 * SECURITY: episodeId validated as UUID; episode fetched owner-scoped.
 *           Audio signed URL is not logged.
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies }                         from "next/headers";
import { getIronSession }                  from "iron-session";
import { getSessionOptions }               from "@/providers/auth";
import { requireBetaAccess }               from "@/providers/owner-guard";
import { episodeRepository, assetRepository } from "@/repositories";
import { buildEpisodeZip }                 from "@/lib/zip-export";
import { z }                               from "zod";
import type { PodLeverSession }            from "@/providers/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const session     = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  let ownerId: string;
  try {
    const identity = await requireBetaAccess(session);
    ownerId = identity.userId;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Validate episode ID ───────────────────────────────────────────────────
  const { id: episodeId } = await params;
  if (!z.string().uuid().safeParse(episodeId).success) {
    return NextResponse.json({ error: "Invalid episode ID" }, { status: 400 });
  }

  // ── Fetch episode (owner-scoped) ──────────────────────────────────────────
  let episode;
  try {
    episode = await episodeRepository.getEpisodeForOwner(episodeId, ownerId);
  } catch {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  if (episode.state !== "ready" && episode.state !== "published") {
    return NextResponse.json({ error: "Episode is not ready yet" }, { status: 409 });
  }

  // ── Build ZIP ─────────────────────────────────────────────────────────────
  try {
    const assets    = await assetRepository.listAssetsForEpisode(episodeId);
    const zipBuffer = await buildEpisodeZip({ episode, assets });

    // Slugify title for the filename
    const slug = episode.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || episodeId;

    console.log(JSON.stringify({
      event:     "episode.zip_download",
      episodeId,
      bytes:     zipBuffer.byteLength,
    }));

    return new NextResponse(new Uint8Array(zipBuffer), {
      status:  200,
      headers: {
        "Content-Type":        "application/zip",
        "Content-Disposition": `attachment; filename="podlever-${slug}.zip"`,
        "Content-Length":      String(zipBuffer.byteLength),
        "Cache-Control":       "private, no-store",
      },
    });
  } catch (err) {
    console.error(JSON.stringify({
      event:     "episode.zip_error",
      episodeId,
      error:     String(err),
    }));
    return NextResponse.json({ error: "Failed to build ZIP" }, { status: 500 });
  }
}
