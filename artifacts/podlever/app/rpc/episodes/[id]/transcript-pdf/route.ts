/**
 * app/rpc/episodes/[id]/transcript-pdf/route.ts — Transcript PDF download
 *
 * Part of: PodLever
 * Created: 2026-07-28
 * Last modified: 2026-07-28 (fix: users expected a PDF export from the episode page)
 *
 * Route: GET /rpc/episodes/[id]/transcript-pdf
 *
 * Generates the transcript PDF on demand (small payload; no GCS involved)
 * and returns it with a proper Content-Disposition filename.
 *
 * Auth: iron-session. Owner-only.
 *
 * SECURITY: episodeId validated as UUID; episode fetched owner-scoped.
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies }                         from "next/headers";
import { getIronSession }                  from "iron-session";
import { getSessionOptions }               from "@/providers/auth";
import { requireBetaAccess }               from "@/providers/owner-guard";
import { episodeRepository, assetRepository } from "@/repositories";
import { generateTranscriptPdf }           from "@/lib/pdf/transcript";
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

  // ── Find transcript asset ─────────────────────────────────────────────────
  const assets     = await assetRepository.listAssetsForEpisode(episodeId);
  const transcript = assets.find((a) => a.assetType === "transcript" && a.content);
  if (!transcript?.content) {
    return NextResponse.json({ error: "No transcript available for this episode" }, { status: 404 });
  }

  // ── Build PDF ─────────────────────────────────────────────────────────────
  try {
    const pdfBuffer = await generateTranscriptPdf({
      title:      episode.title,
      uploadedAt: episode.createdAt
        ? new Date(episode.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : null,
      transcript: transcript.content,
    });

    const slug = episode.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || episodeId;

    console.log(JSON.stringify({
      event:     "episode.transcript_pdf_download",
      episodeId,
      bytes:     pdfBuffer.byteLength,
    }));

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status:  200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="podlever-${slug}-transcript.pdf"`,
        "Content-Length":      String(pdfBuffer.byteLength),
        "Cache-Control":       "private, no-store",
      },
    });
  } catch (err) {
    console.error(JSON.stringify({
      event:     "episode.transcript_pdf_error",
      episodeId,
      error:     String(err),
    }));
    return NextResponse.json({ error: "Failed to build transcript PDF" }, { status: 500 });
  }
}
