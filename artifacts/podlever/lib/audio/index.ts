/**
 * lib/audio/index.ts — Audio enhancement abstraction layer
 *
 * Part of: PodLever
 * Created: 2026-07-20 by agent (Board move 1 — provider abstraction + resilience)
 * Updated: 2026-07-20 — Dolby removed (Jul 19); Adobe removed (Jul 20, no public API)
 * Updated: 2026-07-20 — ffmpeg-adaptive (anlmdn) added as middle tier (Task #64)
 *
 * This is the ONLY file callers should import. Never import providers directly.
 *
 * PROVIDER CHAIN (evaluated in order):
 *   1. ffmpeg-adaptive — Non-Local Means denoiser (anlmdn). Adapts to each recording's
 *                        own noise profile. No API key, no model file, $0 cost.
 *                        Same algorithm as iZotope RX / Cedar professional tools.
 *   2. ffmpeg          — afftdn + loudnorm. Fixed noise-floor threshold denoiser.
 *                        Always available; the guaranteed last resort.
 *
 * PROVIDERS REMOVED:
 *   - Dolby.io (Jul 19 2026): confirmed no new API customers.
 *   - Adobe Podcast Enhance (Jul 20 2026): browser-only tool, no public developer API.
 *
 * FALLBACK BEHAVIOUR:
 *   Any provider failure (timeout, bad input, temp disk full) is caught and logged.
 *   The chain moves to the next provider automatically. The caller always receives a
 *   result. ffmpegProvider is the guaranteed last resort — it runs locally, needs no
 *   credentials, and cannot be externally disrupted.
 *
 * PRODUCT POSITIONING:
 *   Audio enhancement runs silently for every episode. No user-facing provider picker
 *   (revisit when adding a paid external API at scale). The provider that ran is logged
 *   for ops visibility and stored in the COGS record.
 *
 * COST: $0 both tiers.
 *
 * SECURITY: server-only — never import from client components.
 */

import "server-only";

import { ffmpegAdaptiveProvider } from "./providers/ffmpeg-adaptive";
import { ffmpegProvider }         from "./providers/ffmpeg";
import type { AudioProvider, EnhancementResult } from "./types";

// Re-export types so callers only need one import path
export type { EnhancementResult } from "./types";

// ─── Provider chain ───────────────────────────────────────────────────────────

/**
 * PROVIDER_CHAIN — ordered list of enhancement providers, best-first.
 *
 * ffmpegProvider must always be last — it is the no-fail guaranteed fallback.
 *
 * To add a provider: implement AudioProvider, import it here, insert it above
 * ffmpegProvider. The chain evaluates isAvailable() before attempting enhance().
 */
const PROVIDER_CHAIN: AudioProvider[] = [
  ffmpegAdaptiveProvider, // anlmdn — adaptive Non-Local Means denoiser, $0
  ffmpegProvider,         // afftdn — always-on guaranteed fallback, $0
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
