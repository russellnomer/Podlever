/**
 * app/rpc/episodes/[id]/guest-pack/route.ts — Guest media pack PDF download
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — guest pack PDF)
 *
 * Route: GET /rpc/episodes/[id]/guest-pack
 *
 * If a pre-generated PDF exists in GCS (stored during processing), serves it
 * via a signed URL redirect. If not (legacy episodes), generates on-demand.
 *
 * Auth: iron-session. Owner-only.
 *
 * SECURITY: signed GCS URLs expire in 15 minutes (browser download only).
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies }                         from "next/headers";
import { getIronSession }                  from "iron-session";
import { getSessionOptions }               from "@/providers/auth";
import { requireBetaAccess }               from "@/providers/owner-guard";
import { episodeRepository, assetRepository } from "@/repositories";
import { getSignedDownloadUrl, uploadFileBuffer } from "@/lib/storage";
import { generateGuestPackPdf }            from "@/lib/pdf/guest-pack";
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

  // ── Check for existing PDF asset ──────────────────────────────────────────
  const allAssets  = await assetRepository.listAssetsForEpisode(episodeId);
  const pdfAsset   = allAssets.find((a) => a.assetType === "guest_media_pack_pdf" && a.storageKey);
  const textAsset  = allAssets.find((a) => a.assetType === "guest_media_pack");

  if (!textAsset?.content) {
    return NextResponse.json({ error: "Guest media pack not yet generated" }, { status: 409 });
  }

  try {
    let pdfStorageKey: string;

    if (pdfAsset?.storageKey) {
      // Already generated during processing — serve via signed URL
      pdfStorageKey = pdfAsset.storageKey;
    } else {
      // On-demand generation (legacy episodes processed before this feature)
      console.log(JSON.stringify({ event: "guest_pack.on_demand_generate", episodeId }));

      const pdfBuffer = await generateGuestPackPdf({
        episodeTitle: episode.title,
        content:      textAsset.content,
        episodeDate:  new Date(episode.createdAt),
      });

      pdfStorageKey = `pdfs/${episodeId}/guest-pack.pdf`;
      await uploadFileBuffer(pdfStorageKey, pdfBuffer, "application/pdf");

      // Persist for next request
      await assetRepository.createAssetVersion({
        episodeId,
        assetType:  "guest_media_pack_pdf",
        label:      "Guest media pack PDF (on-demand)",
        storageKey: pdfStorageKey,
        content:    null,
      });
    }

    // Redirect to a signed URL (browser handles the download)
    const signedUrl = await getSignedDownloadUrl(pdfStorageKey, 15 * 60 * 1000);

    // Slug for the download filename
    const slug = episode.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || episodeId;

    // Use redirect so the client downloads directly from GCS
    return NextResponse.redirect(
      `${signedUrl}&response-content-disposition=${encodeURIComponent(`attachment; filename="guest-pack-${slug}.pdf"`)}`,
    );

  } catch (err) {
    console.error(JSON.stringify({
      event:     "guest_pack.error",
      episodeId,
      error:     String(err),
    }));
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
