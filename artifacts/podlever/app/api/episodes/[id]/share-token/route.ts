/**
 * app/api/episodes/[id]/share-token/route.ts — Generate shareable episode link
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — viral shareable links)
 *
 * Route: POST /api/episodes/[id]/share-token
 *
 * Generates a share token on the episode (UUID). The token enables the public
 * read-only page at /share/[token]. Idempotent — returns existing token if set.
 *
 * DELETE /api/episodes/[id]/share-token — revokes sharing (sets token to null).
 *
 * Auth: iron-session. Owner-only.
 * The public /share/[token] page requires no auth — that's intentional (viral).
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies }                         from "next/headers";
import { getIronSession }                  from "iron-session";
import { getSessionOptions }               from "@/providers/auth";
import { requireBetaAccess }               from "@/providers/owner-guard";
import { episodeRepository }               from "@/repositories";
import { db }                              from "@/db";
import { episodes }                        from "@/db/schema";
import { eq }                              from "drizzle-orm";
import { randomUUID }                      from "crypto";
import { z }                               from "zod";
import type { PodLeverSession }            from "@/providers/auth";

async function getOwner(session: PodLeverSession): Promise<string> {
  const identity = await requireBetaAccess(session);
  return identity.userId;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const session     = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  let ownerId: string;
  try { ownerId = await getOwner(session); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const { id: episodeId } = await params;
  if (!z.string().uuid().safeParse(episodeId).success) {
    return NextResponse.json({ error: "Invalid episode ID" }, { status: 400 });
  }

  try {
    const episode = await episodeRepository.getEpisodeForOwner(episodeId, ownerId);

    // Idempotent — return existing token if one already exists
    if (episode.shareToken) {
      return NextResponse.json({ shareToken: episode.shareToken });
    }

    const shareToken = randomUUID();

    await db
      .update(episodes)
      .set({ shareToken })
      .where(eq(episodes.id, episodeId));

    console.log(JSON.stringify({ event: "episode.share_enabled", episodeId }));
    return NextResponse.json({ shareToken });

  } catch {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const session     = await getIronSession<PodLeverSession>(cookieStore, getSessionOptions());
  let ownerId: string;
  try { ownerId = await getOwner(session); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const { id: episodeId } = await params;
  if (!z.string().uuid().safeParse(episodeId).success) {
    return NextResponse.json({ error: "Invalid episode ID" }, { status: 400 });
  }

  try {
    await episodeRepository.getEpisodeForOwner(episodeId, ownerId);
    await db.update(episodes).set({ shareToken: null }).where(eq(episodes.id, episodeId));

    console.log(JSON.stringify({ event: "episode.share_disabled", episodeId }));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }
}
