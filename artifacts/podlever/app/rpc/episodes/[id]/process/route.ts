/**
 * app/rpc/episodes/[id]/process/route.ts — Episode AI processing pipeline
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — close product/promise gap)
 *
 * Route: POST /rpc/episodes/[id]/process
 *
 * Pipeline (in order):
 *   1.  Fetch episode + verify audio key exists
 *   2.  Download original audio from GCS
 *   3.  Audio enhancement (ffmpeg-adaptive → ffmpeg provider chain)
 *   4.  Upload cleaned audio to GCS → update episode.cleanedAudioStorageKey
 *   5.  Transcribe via Whisper → log COGS
 *   6.  Store transcript asset
 *   7.  Generate show_notes, blog_post, social_post, guest_media_pack in parallel → log COGS
 *   8.  Generate guest media pack PDF → upload to GCS → store as asset
 *   9.  Transition episode: processing → ready
 *   10. Record usage event + analytics
 *
 * Auth: CRON_SECRET bearer token — internal only, never from browser.
 * Error: logs full error chain; leaves episode in "processing" (worker retries).
 *
 * SECURITY: server-only. Authorized by CRON_SECRET. No PII in logs.
 * PRIVACY: OpenAI chat calls include user: "none" (disables per-user tracking).
 *          Audio content is sent to OpenAI Whisper for transcription per our privacy policy.
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                          from "zod";
import { openai, MODELS }             from "@/lib/openai";
import {
  downloadAudioBuffer,
  uploadFileBuffer,
}                                     from "@/lib/storage";
import { enhanceAudio }               from "@/lib/audio";
import { prepareForTranscription }    from "@/lib/audio/transcode";

/** Control-flow marker: enhancement intentionally skipped (large/video input). */
class SkipEnhancement extends Error {
  constructor() { super("enhancement skipped"); }
}
import { recordCogs, estimateAudioCost, estimateTokenCost, PRICING_USD } from "@/lib/cogs";
import { generateGuestPackPdf }       from "@/lib/pdf/guest-pack";
import {
  episodeRepository,
  assetRepository,
  usageRepository,
}                                     from "@/repositories";
import { executeTransition }          from "@/server/fsm";
import { trackServerEvent }           from "@/lib/analytics";
import { db }                         from "@/db";
import { episodes, users }            from "@/db/schema";
import { eq }                         from "drizzle-orm";
import { randomUUID }                 from "crypto";
import { isCronAuthorized }           from "@/lib/cron-auth";
import { toFile }                     from "openai";
import { buildPersonaBlock, resolvePersona } from "@/lib/personas";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  // Constant-time, header-only (Security sprint PR #22).
  return isCronAuthorized(req.headers.get("authorization"));
}

// ─── Asset generation prompts ─────────────────────────────────────────────────

/**
 * BASE_PROMPTS — content-type instructions without audience context.
 * Persona block is prepended at runtime via buildSystemPrompts().
 * This separation means the persona system is additive — base prompts
 * work correctly on their own (fallback if persona lookup fails).
 */
const BASE_PROMPTS: Record<string, string> = {
  show_notes: `You are a podcast producer writing structured show notes.
Given a podcast transcript, produce clean, reader-friendly show notes in markdown:
- An engaging 2-3 sentence episode summary
- Key takeaways (3-5 bullet points)
- Topics covered (brief section list)
- Notable quotes (1-2 direct quotes with attribution)
Return only the markdown — no preamble, no meta-commentary.`,

  blog_post: `You are a content strategist converting a podcast episode into a long-form blog post.
Given a transcript, write a compelling blog post following the AUDIENCE & TONE rules above:
- An SEO-friendly headline (H1)
- An engaging introduction that hooks the reader
- 3-4 well-developed sections (H2 subheadings)
- A strong closing paragraph with a call to action
Respect the length cap specified in the AUDIENCE CONTEXT. Return only the blog post markdown.`,

  social_post: `You are a social media manager writing promotional copy for a podcast episode.
Given a transcript, produce THREE social media posts using the platform-specific format rules above:

**LinkedIn:**
[post — follow LinkedIn format rules from AUDIENCE CONTEXT]

**Twitter/X:**
[post — follow Twitter/X format rules from AUDIENCE CONTEXT]

**Instagram caption:**
[post — follow Instagram format rules from AUDIENCE CONTEXT]

Return only the three posts in that exact format — no other text.`,

  guest_media_pack: `You are a podcast producer creating a guest media pack.
Given a transcript, produce a structured guest media pack in markdown:
- **Guest name and title** (infer from transcript)
- **Bio blurb** (2-3 sentences suitable for show notes)
- **Key topics discussed** (5-7 bullet points)
- **Suggested social announcement** (short caption the guest can post)
- **Suggested follow-up questions** (3 questions for future conversations)
- **Notable quotes** (2-3 direct quotes with attribution)
Return only the markdown — no preamble.`,
};

/**
 * buildSystemPrompts — Construct audience-aware system prompts for all asset types.
 *
 * Prepends the persona block (audience context + tone/format rules) to every
 * base prompt. The persona block is the first thing the model reads, so it
 * sets the register before any content-type instructions.
 *
 * @param personaBlock  Output of buildPersonaBlock(persona) from lib/personas.ts
 */
function buildSystemPrompts(personaBlock: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(BASE_PROMPTS).map(([key, basePrompt]) => [
      key,
      `${personaBlock}\n\n---\n\nCONTENT TYPE INSTRUCTIONS:\n${basePrompt}`,
    ]),
  );
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: episodeId } = await params;
  if (!z.string().uuid().safeParse(episodeId).success) {
    return NextResponse.json({ error: "Invalid episode ID" }, { status: 400 });
  }

  const startMs = Date.now();
  console.log(JSON.stringify({ event: "episode.process.start", episodeId, ts: new Date().toISOString() }));

  try {
    // ── 1. Fetch episode ────────────────────────────────────────────────────
    const episode = await episodeRepository.getEpisodeById(episodeId);
    if (!episode.audioStorageKey) {
      return NextResponse.json({ error: "No audio uploaded for this episode" }, { status: 422 });
    }
    const { ownerId, audioStorageKey, fsmVersion } = episode;

    // Fetch user's audience persona for content personalization.
    // Runs in parallel with nothing — do it here before we start the pipeline.
    const [userRow] = await db
      .select({ audiencePersona: users.audiencePersona, plan: users.plan })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    const persona      = resolvePersona(userRow?.audiencePersona ?? "general", userRow?.plan ?? "free");
    const personaBlock = buildPersonaBlock(persona);
    // Build audience-aware system prompts — injected into every text generation call.
    const SYSTEM_PROMPTS = buildSystemPrompts(personaBlock);

    console.log(JSON.stringify({
      event:    "episode.process.persona",
      episodeId,
      persona,
      plan:     userRow?.plan ?? "free",
    }));

    // ── 2. Download original audio ──────────────────────────────────────────
    await episodeRepository.setProcessingError(episodeId, null);
    await episodeRepository.setProcessingStage(episodeId, "downloading");
    const originalBuffer = await downloadAudioBuffer(audioStorageKey);
    const ext            = audioStorageKey.split(".").pop() ?? "mp3";
    const mimeMap: Record<string, string> = {
      mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
      ogg: "audio/ogg",  flac: "audio/flac",
      mp4: "video/mp4",  mov: "video/quicktime", webm: "video/webm",
      m4v: "video/mp4",  mpeg: "video/mpeg",     mpg: "video/mpeg",
    };
    const mimeType = mimeMap[ext] ?? "audio/mpeg";
    // (isVideo no longer gates enhancement — providers strip video with -vn)

    // Fallback duration estimate (rough: 128kbps MP3 ≈ 16KB/s) — replaced by
    // the real ffprobe duration from prepareForTranscription when available.
    let estimatedAudioSeconds = Math.round(originalBuffer.byteLength / (128 * 1024 / 8));

    // ── 3. Audio enhancement (ffmpeg-adaptive → ffmpeg provider chain) ────────
    // enhanceAudio selects the best available provider and falls back through
    // the chain automatically. FFmpeg is always the guaranteed last resort.
    let processedBuffer: Buffer = originalBuffer;
    let processedMime:   string = mimeType;

    // Enhancement providers strip video (-vn) and output compressed MP3
    // (2026-07-27 — previously WAV-only, so video and >25MB inputs skipped
    // enhancement entirely and the advertised "Cleaned Audio" deliverable
    // was never produced). Cap now matches the 300MB upload limit; only
    // truly oversized inputs skip.
    const ENHANCE_MAX_BYTES = 300 * 1024 * 1024;
    const skipEnhancement   = originalBuffer.byteLength > ENHANCE_MAX_BYTES;
    if (!skipEnhancement) await episodeRepository.setProcessingStage(episodeId, "enhancing");

    // Track enhancement outcome — persisted after the try/catch block.
    // Values: "enhanced" | "fallback" | "skipped"
    // Displayed as a badge on the episode page so users can see what happened.
    let audioEnhancementStatus: "enhanced" | "fallback" | "skipped" = "skipped";

    try {
      if (skipEnhancement) {
        console.log(JSON.stringify({
          event: "audio.enhance.skipped", episodeId,
          reason: "oversized_input",
          bytes: originalBuffer.byteLength,
        }));
        throw new SkipEnhancement();
      }
      const enhanceResult = await enhanceAudio(originalBuffer, mimeType, episodeId);
      processedBuffer = enhanceResult.buffer;
      processedMime   = enhanceResult.mimeType;

      // ── 4. Upload enhanced audio to GCS ────────────────────────────────────
      const cleanedKey = `audio/${episodeId}/cleaned.mp3`;
      await uploadFileBuffer(cleanedKey, processedBuffer, processedMime);

      // Update episode row with enhanced audio key
      await db
        .update(episodes)
        .set({ cleanedAudioStorageKey: cleanedKey })
        .where(eq(episodes.id, episodeId));

      // Create / update the cleaned_audio asset — label reflects actual provider
      await assetRepository.createAssetVersion({
        episodeId,
        assetType:  "cleaned_audio",
        label:      `${enhanceResult.provider} enhanced audio`,
        storageKey: cleanedKey,
        content:    null,
      });

      // Record COGS — provider.name matches PRICING_USD keys ("adobe", "ffmpeg")
      type AudioModel = Parameters<typeof estimateAudioCost>[0];
      const knownModels = new Set<string>(["ffmpeg-adaptive", "ffmpeg", "gpt-4o-mini-transcribe", "gpt-5.6-luna"]);
      const enhanceModel = (knownModels.has(enhanceResult.provider) ? enhanceResult.provider : "ffmpeg") as AudioModel;
      const enhanceCost  = estimateAudioCost(enhanceModel, estimatedAudioSeconds);
      recordCogs({
        episodeId,
        userId:       ownerId,
        step:         "audio_cleanup",
        model:        enhanceResult.provider,
        audioSeconds: estimatedAudioSeconds,
        costUsd:      enhanceCost,
      }).catch((err) => console.error(JSON.stringify({ event: "cogs.record.failed", step: "audio_cleanup", error: String(err) })));

      // Enhancement succeeded
      audioEnhancementStatus = "enhanced";

    } catch (err) {
      if (!(err instanceof SkipEnhancement)) {
        // All providers failed (extremely rare — FFmpeg should always succeed).
        // Log and continue with original audio; transcription still works.
        console.warn(JSON.stringify({
          event:     "audio.enhance.all_failed",
          episodeId,
          error:     err instanceof Error ? err.message : String(err),
        }));
        // Enhancement was attempted but failed
        audioEnhancementStatus = "fallback";
      }
      // SkipEnhancement → status stays "skipped"
    }

    // Persist enhancement status so the episode page can show the badge.
    // Non-fatal if this write fails — pipeline continues without it.
    await db
      .update(episodes)
      .set({ audioEnhancementStatus })
      .where(eq(episodes.id, episodeId))
      .catch((err) => console.warn(JSON.stringify({
        event: "episode.enhancement_status.save_failed",
        episodeId,
        error: String(err),
      })));

    console.log(JSON.stringify({
      event:                  "audio.enhancement.status",
      episodeId,
      audioEnhancementStatus,
    }));

    await episodeRepository.setProcessingStage(episodeId, "transcribing");
    // ── 5. Compress + transcribe ────────────────────────────────────────────
    // The transcription API caps requests at 25 MB, so ALL audio (enhanced or
    // original, audio or video) is compressed to speech-optimized mono MP3
    // first, and split into chunks when a compressed episode still exceeds
    // the cap (100+ minutes). Chunks are transcribed in order and joined.
    const processedExt =
      processedMime === "audio/mpeg" ? "mp3"
      : processedMime === "audio/wav" ? "wav"
      : ext;
    const { chunks, durationSeconds } = await prepareForTranscription(processedBuffer, processedExt);
    if (durationSeconds) {
      estimatedAudioSeconds = Math.round(durationSeconds);
    }

    const transcriptParts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const audioFile     = await toFile(chunks[i]!, `episode-part-${i}.mp3`, { type: "audio/mpeg" });
      const transcription = await openai.audio.transcriptions.create({
        model: MODELS.transcription,
        file:  audioFile,
      });
      transcriptParts.push(transcription.text.trim());
      if (chunks.length > 1) {
        console.log(JSON.stringify({
          event: "episode.process.chunk_transcribed",
          episodeId, chunk: i + 1, of: chunks.length,
        }));
      }
    }
    const transcript = transcriptParts.join("\n\n");

    const transcriptCost = estimateAudioCost("gpt-4o-mini-transcribe", estimatedAudioSeconds);
    recordCogs({
      episodeId,
      userId:       ownerId,
      step:         "transcription",
      model:        MODELS.transcription,
      audioSeconds: estimatedAudioSeconds,
      costUsd:      transcriptCost,
    }).catch((err) => console.error(JSON.stringify({ event: "cogs.record.failed", step: "transcription", error: String(err) })));

    console.log(JSON.stringify({ event: "episode.process.transcribed", episodeId, chars: transcript.length }));

    // ── 6. Store transcript asset ───────────────────────────────────────────
    await assetRepository.createAssetVersion({
      episodeId,
      assetType:  "transcript",
      label:      "AI transcript",
      content:    transcript,
      storageKey: null,
    });

    await episodeRepository.setProcessingStage(episodeId, "generating");
    // ── 7. Generate text assets in parallel ─────────────────────────────────
    const textAssetTypes = ["show_notes", "blog_post", "social_post", "guest_media_pack"] as const;

    const generated = await Promise.all(
      textAssetTypes.map(async (assetType) => {
        const response = await openai.chat.completions.create({
          model:    MODELS.generation,
          messages: [
            { role: "system", content: SYSTEM_PROMPTS[assetType]! },
            { role: "user",   content: `Here is the podcast transcript:\n\n${transcript}` },
          ],
          max_completion_tokens: 2048,
          // Privacy: "none" disables per-user request tracking in the API logs
          user: "none",
        });

        const content  = response.choices[0]?.message?.content ?? "";
        const tokensIn  = response.usage?.prompt_tokens    ?? 0;
        const tokensOut = response.usage?.completion_tokens ?? 0;
        const cost      = estimateTokenCost(PRICING_USD["gpt-5.6-luna"] ? "gpt-5.6-luna" : "gpt-5.6-luna", tokensIn, tokensOut);

        recordCogs({
          episodeId,
          userId:    ownerId,
          step:      assetType as "show_notes" | "blog_post" | "social_post" | "guest_media_pack",
          model:     MODELS.generation,
          tokensIn,
          tokensOut,
          costUsd:   cost,
        }).catch((err) => console.error(JSON.stringify({ event: "cogs.record.failed", step: assetType, error: String(err) })));

        return { assetType, content, tokensIn, tokensOut };
      }),
    );

    // Store each text asset
    await Promise.all(
      generated.map(({ assetType, content }) =>
        assetRepository.createAssetVersion({
          episodeId,
          assetType,
          label:      `AI-generated ${assetType.replace(/_/g, " ")}`,
          content,
          storageKey: null,
        }),
      ),
    );

    console.log(JSON.stringify({ event: "episode.process.assets_created", episodeId, count: generated.length + 1 }));

    await episodeRepository.setProcessingStage(episodeId, "packaging");
    // ── 8. Generate guest media pack PDF ────────────────────────────────────
    const guestPackContent = generated.find((g) => g.assetType === "guest_media_pack")?.content ?? "";

    if (guestPackContent) {
      try {
        const pdfBuffer = await generateGuestPackPdf({
          episodeTitle: episode.title,
          content:      guestPackContent,
          episodeDate:  new Date(episode.createdAt),
        });

        const pdfKey = `pdfs/${episodeId}/guest-pack.pdf`;
        await uploadFileBuffer(pdfKey, pdfBuffer, "application/pdf");

        // Store PDF as a versioned asset with storage_key (not content)
        await assetRepository.createAssetVersion({
          episodeId,
          assetType:  "guest_media_pack_pdf",
          label:      "Guest media pack PDF",
          storageKey: pdfKey,
          content:    null,
        });

        // Log COGS for PDF generation (negligible compute; track for completeness)
        recordCogs({
          episodeId,
          userId:   ownerId,
          step:     "pdf_generation",
          model:    "pdfkit",
          costUsd:  0,
        }).catch(() => {});

        console.log(JSON.stringify({ event: "episode.process.pdf_created", episodeId, pdfKey }));
      } catch (pdfErr) {
        // Non-fatal — text version of guest pack still exists
        console.warn(JSON.stringify({
          event:     "episode.process.pdf_failed",
          episodeId,
          error:     String(pdfErr),
        }));
      }
    }

    // ── 9. Transition episode: processing → ready ───────────────────────────
    const latestEpisode = await episodeRepository.getEpisodeById(episodeId);
    await executeTransition({
      episodeId,
      ownerId,
      fromState:         "processing",
      currentFsmVersion: latestEpisode.fsmVersion,
      toState:           "ready",
      idempotencyKey:    randomUUID(),
      metadata:          JSON.stringify({
        source:     "process-route",
        assetCount: generated.length + 1,
        durationMs: Date.now() - startMs,
      }),
    });

    // ── 10. Usage event + analytics ─────────────────────────────────────────
    await usageRepository.recordUsageEvent(ownerId, episodeId, "episode_processed").catch((err) => {
      console.error(JSON.stringify({ event: "usage.record.failed", episodeId, error: String(err) }));
    });
    trackServerEvent("episode_processed", ownerId, {
      episodeId,
      assetCount:      generated.length + 1,
      transcriptChars: transcript.length,
      durationMs:      Date.now() - startMs,
    });

    await episodeRepository.setProcessingStage(episodeId, null);

    console.log(JSON.stringify({
      event:     "episode.process.complete",
      episodeId,
      durationMs: Date.now() - startMs,
    }));
    return NextResponse.json({ ok: true, episodeId });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface the failure on the episode row so the UI can show which stage
    // died and why (instead of an eternal spinner). Retries clear it.
    await episodeRepository.setProcessingError(episodeId, message.slice(0, 500));
    console.error(JSON.stringify({
      event:     "episode.process.error",
      episodeId,
      error:     err instanceof Error ? err.message : String(err),
      cause:     err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined,
      durationMs: Date.now() - startMs,
    }));
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
