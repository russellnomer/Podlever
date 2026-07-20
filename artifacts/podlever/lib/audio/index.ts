/**
 * lib/audio/index.ts — Audio enhancement abstraction layer
 *
 * Part of: PodLever
 * Created: 2026-07-20 by agent (Board move 1 — provider abstraction + resilience)
 * Updated: 2026-07-20 — Dolby removed; Dolby.io confirmed no new API customers (Jul 19 2026)
 *
 * This is the ONLY file callers should import. Never import providers directly.
 *
 * PROVIDER CHAIN (evaluated in order):
 *   1. Adobe  — excellent quality, free beta; requires ADOBE_ENHANCE_API_KEY
 *   2. FFmpeg — good quality, always available, $0 cost — the guaranteed fallback
 *
 * FALLBACK BEHAVIOUR:
 *   Any provider failure (network, API error, timeout, missing credentials) is
 *   caught and logged. The chain moves to the next provider automatically.
 *   The caller always receives a result — enhanced audio is guaranteed.
 *
 *   If Adobe is unavailable or fails, FFmpeg runs as the final safety net.
 *   FFmpeg is always available on the Replit container and cannot fail unless
 *   the temp filesystem is full or the input is corrupt.
 *
 * PRODUCT POSITIONING:
 *   Audio enhancement runs silently for every episode.
 *   There is no user-facing provider picker (revisit at 100 paying users).
 *   The provider that ran is logged for ops visibility and stored in the asset label.
 *
 * COST:
 *   Adobe: $0 (beta) | FFmpeg: $0
 *   COGS are recorded by the process route using result.provider.
 *
 * SECURITY: server-only — never import from client components.
 */

import "server-only";

import { adobeProvider }  from "./providers/adobe";
import { ffmpegProvider } from "./providers/ffmpeg";
import type { AudioProvider, EnhancementResult } from "./types";

// Re-export types so callers only need one import path
export type { EnhancementResult } from "./types";

// ─── Provider chain ───────────────────────────────────────────────────────────

/**
 * PROVIDER_CHAIN — ordered list of enhancement providers.
 *
 * External providers are attempted first (best quality). FFmpeg is always
 * last — it cannot be disabled and provides the guaranteed fallback.
 *
 * To add a provider: implement AudioProvider, import it here, insert it in
 * the chain above ffmpegProvider.
 */
const PROVIDER_CHAIN: AudioProvider[] = [
  adobeProvider,   // free beta — available when ADOBE_ENHANCE_API_KEY is set
  ffmpegProvider,  // always available — guaranteed last resort
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * enhanceAudio — Enhance audio using the best available provider.
 *
 * Selects the first available provider in PROVIDER_CHAIN and attempts
 * enhancement. If it fails, falls through to the next provider.
 * FFmpeg is always the final provider and will not be skipped.
 *
 * @param input         Raw audio bytes
 * @param inputMimeType MIME type of the input (e.g. "audio/mpeg")
 * @param episodeId     Used for logging and temp file namespacing
 * @returns             EnhancementResult — always succeeds (FFmpeg is the safety net)
 * @throws              Only if even FFmpeg fails (e.g. corrupt audio, full disk)
 */
export async function enhanceAudio(
  input:         Buffer,
  inputMimeType: string,
  episodeId:     string,
): Promise<EnhancementResult> {
  const available = PROVIDER_CHAIN.filter((p) => p.isAvailable());

  // Always include FFmpeg as the last resort even if isAvailable() returned
  // false for it (it should never, but be defensive)
  if (!available.includes(ffmpegProvider)) {
    available.push(ffmpegProvider);
  }

  console.info(JSON.stringify({
    event:    "audio.enhance.start",
    episodeId,
    chain:    available.map((p) => p.name),
  }));

  let lastError: unknown;

  for (const provider of available) {
    try {
      console.info(JSON.stringify({ event: "audio.enhance.trying", episodeId, provider: provider.name }));

      const result = await provider.enhance(input, inputMimeType, episodeId);

      console.info(JSON.stringify({
        event:    "audio.enhance.success",
        episodeId,
        provider: provider.name,
        bytes:    result.buffer.byteLength,
      }));

      return result;

    } catch (err) {
      lastError = err;

      // Log the failure and fall through to the next provider
      console.warn(JSON.stringify({
        event:    "audio.enhance.provider_failed",
        episodeId,
        provider: provider.name,
        error:    err instanceof Error ? err.message : String(err),
      }));

      // If this is NOT the last provider, log that we're falling back
      const nextProvider = available[available.indexOf(provider) + 1];
      if (nextProvider) {
        console.info(JSON.stringify({
          event:    "audio.enhance.fallback",
          episodeId,
          from:     provider.name,
          to:       nextProvider.name,
        }));
      }
    }
  }

  // This should never be reached — FFmpeg is always in the chain.
  // If it somehow is, surface the last error clearly.
  throw new Error(
    `All audio enhancement providers failed for episode ${episodeId}. ` +
    `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
