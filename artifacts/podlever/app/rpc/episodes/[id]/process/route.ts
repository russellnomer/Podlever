/**
 * app/rpc/episodes/[id]/process/route.ts — Episode AI processing pipeline
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #2 — Episode processing pipeline)
 *
 * Route: POST /rpc/episodes/[id]/process
 *
 * Auth: CRON_SECRET bearer token (internal — called by uploadEpisodeAction after-hook).
 * Never called directly by the browser.
 *
 * Pipeline (sequential):
 *   1. Fetch episode → get audioStorageKey + ownerId
 *   2. Download audio from GCS → Buffer
 *   3. Transcribe via OpenAI gpt-4o-mini-transcribe
 *   4. Store transcript as asset (content in DB)
 *   5. Generate show_notes, blog_post, social_post, guest_media_pack via GPT
 *   6. Transition episode: processing → ready
 *
 * Error handling: logs error, leaves episode in "processing" state.
 * The owner can see it is stalled on the detail page; retry via re-upload for beta.
 *
 * SECURITY NOTES:
 *   - No user session check — authenticated exclusively via CRON_SECRET.
 *   - Internal-only; never routed from the public internet.
 *   - episodeId validated as UUID before any DB query.
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                          from "zod";
import { openai, MODELS }             from "@/lib/openai";
import { downloadAudioBuffer }        from "@/lib/storage";
import { episodeRepository, assetRepository, usageRepository } from "@/repositories";
import { executeTransition }          from "@/server/fsm";
import { trackServerEvent }           from "@/lib/analytics";
import { randomUUID }                 from "crypto";
import { toFile }                     from "openai";

// ─── Auth helper ──────────────────────────────────────────────────────────────

/** Rejects requests that don't carry the correct CRON_SECRET bearer token. */
function isAuthorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token  = header.replace(/^Bearer\s+/i, "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token === secret;
}

// ─── Asset generation prompts ─────────────────────────────────────────────────

/**
 * SYSTEM_PROMPTS — one prompt per generated asset type.
 * Each prompt receives the transcript as user content and returns the asset text.
 */
const SYSTEM_PROMPTS: Record<string, string> = {
  show_notes: `You are a podcast producer writing structured show notes.
Given a podcast transcript, produce clean, reader-friendly show notes in markdown:
- An engaging 2-3 sentence episode summary
- Key takeaways (3-5 bullet points)
- Topics covered (brief section list)
- Notable quotes (1-2 direct quotes with attribution)
Return only the markdown — no preamble, no meta-commentary.`,

  blog_post: `You are a content strategist converting a podcast episode into a long-form blog post.
Given a transcript, write a compelling 600-900 word blog post:
- An SEO-friendly headline (H1)
- An engaging introduction that hooks the reader
- 3-4 well-developed sections (H2 subheadings)
- A strong closing paragraph with a call to action
Write in a professional but conversational tone. Return only the blog post markdown.`,

  social_post: `You are a social media manager writing promotional copy for a podcast episode.
Given a transcript, produce THREE social media posts in this exact format:

**LinkedIn (professional, 150-200 words):**
[post]

**Twitter/X (punchy, under 280 chars):**
[post]

**Instagram caption (engaging, 100-150 words + 5 relevant hashtags):**
[post]

Return only the three posts in that format — no other text.`,

  guest_media_pack: `You are a podcast producer creating a guest media pack.
Given a transcript, produce a structured guest media pack in markdown:
- **Guest name and title** (infer from transcript)
- **Bio blurb** (2-3 sentences suitable for show notes)
- **Key topics discussed** (5-7 bullet points)
- **Suggested social announcement** (short caption the guest can post)
- **Suggested follow-up questions** (3 questions for future conversations)
Return only the markdown — no preamble.`,
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Validate episodeId ──────────────────────────────────────────────────────
  const { id: episodeId } = await params;
  const uuidResult = z.string().uuid().safeParse(episodeId);
  if (!uuidResult.success) {
    return NextResponse.json({ error: "Invalid episode ID" }, { status: 400 });
  }

  console.log(JSON.stringify({ event: "episode.process.start", episodeId, ts: new Date().toISOString() }));

  try {
    // ── 1. Fetch episode ──────────────────────────────────────────────────────
    const episode = await episodeRepository.getEpisodeById(episodeId);
    if (!episode.audioStorageKey) {
      return NextResponse.json({ error: "No audio uploaded for this episode" }, { status: 422 });
    }
    const { ownerId, audioStorageKey, fsmVersion } = episode;

    // ── 2. Download audio from GCS ────────────────────────────────────────────
    const audioBuffer = await downloadAudioBuffer(audioStorageKey);

    // Derive filename + MIME from storage key (e.g. "audio/{id}/original.mp3")
    const ext      = audioStorageKey.split(".").pop() ?? "mp3";
    const mimeMap: Record<string, string> = {
      mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
      ogg: "audio/ogg",  flac: "audio/flac",
    };
    const mimeType = mimeMap[ext] ?? "audio/mpeg";

    // ── 3. Transcribe with OpenAI Whisper ─────────────────────────────────────
    const audioFile = await toFile(audioBuffer, `episode.${ext}`, { type: mimeType });
    const transcription = await openai.audio.transcriptions.create({
      model: MODELS.transcription,
      file:  audioFile,
    });
    const transcript = transcription.text;

    console.log(JSON.stringify({ event: "episode.process.transcribed", episodeId, chars: transcript.length, ts: new Date().toISOString() }));

    // ── 4. Store transcript asset ─────────────────────────────────────────────
    await assetRepository.createAssetVersion({
      episodeId,
      assetType:  "transcript",
      label:      "AI transcript",
      content:    transcript,
      storageKey: null,
    });

    // ── 5. Generate text assets in parallel ───────────────────────────────────
    const assetTypes = ["show_notes", "blog_post", "social_post", "guest_media_pack"] as const;

    const generated = await Promise.all(
      assetTypes.map(async (assetType) => {
        const response = await openai.chat.completions.create({
          model:    MODELS.generation,
          messages: [
            { role: "system",  content: SYSTEM_PROMPTS[assetType]! },
            { role: "user",    content: `Here is the podcast transcript:\n\n${transcript}` },
          ],
          max_completion_tokens: 2048,
        });
        return { assetType, content: response.choices[0]?.message?.content ?? "" };
      }),
    );

    // Store each generated asset
    await Promise.all(
      generated.map(({ assetType, content }) =>
        assetRepository.createAssetVersion({
          episodeId,
          assetType,
          label:     `AI-generated ${assetType.replace(/_/g, " ")}`,
          content,
          storageKey: null,
        }),
      ),
    );

    console.log(JSON.stringify({ event: "episode.process.assets_created", episodeId, count: generated.length + 1, ts: new Date().toISOString() }));

    // ── 6. Transition episode: processing → ready ─────────────────────────────
    await executeTransition({
      episodeId,
      ownerId,
      fromState:         "processing",
      currentFsmVersion: fsmVersion,
      toState:           "ready",
      idempotencyKey:    randomUUID(),
      metadata:          JSON.stringify({ source: "process-route", assetCount: generated.length + 1 }),
    });

    // ── 7. Record usage event + analytics (non-blocking) ─────────────────────
    await usageRepository.recordUsageEvent(ownerId, episodeId, "episode_processed").catch((err) => {
      console.error(JSON.stringify({ event: "usage.record.failed", episodeId, error: String(err) }));
    });
    trackServerEvent("episode_processed", ownerId, {
      episodeId,
      assetCount: generated.length + 1,
      transcriptChars: transcript.length,
    });

    console.log(JSON.stringify({ event: "episode.process.complete", episodeId, ts: new Date().toISOString() }));
    return NextResponse.json({ ok: true, episodeId });

  } catch (err) {
    // Leave episode in "processing" — owner sees a stalled state on the detail page.
    // Full error logged for debugging; no PII in the message.
    console.error(JSON.stringify({
      event:     "episode.process.error",
      episodeId,
      error:     err instanceof Error ? err.message : String(err),
      ts:        new Date().toISOString(),
    }));
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
