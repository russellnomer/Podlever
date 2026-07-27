/**
 * lib/audio/types.ts — Shared types for the audio enhancement abstraction layer
 *
 * Part of: PodLever
 * Created: 2026-07-20 by agent (Board move 1 — audio provider abstraction)
 *
 * Every audio enhancement provider implements AudioProvider. The index selects
 * the best available provider and falls back through the chain automatically.
 * Callers only ever import from lib/audio/index.ts.
 *
 * SECURITY: server-only — never import from client components.
 */

"server-only";

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * EnhancementResult — returned by every provider on success.
 *
 * @field buffer   - Enhanced audio bytes, always WAV for downstream compatibility
 * @field mimeType - "audio/mpeg" (128k mono MP3, since 2026-07-27) or legacy "audio/wav"
 * @field provider - Human-readable provider name used for logging and COGS tracking
 */
export interface EnhancementResult {
  buffer:   Buffer;
  mimeType: "audio/wav" | "audio/mpeg";
  provider: string;
}

// ─── Provider contract ────────────────────────────────────────────────────────

/**
 * AudioProvider — interface every enhancement provider must implement.
 *
 * Providers must be self-contained: all auth, polling, and error handling
 * happen inside enhance(). If enhance() throws, the index falls back to the
 * next provider in the chain.
 */
export interface AudioProvider {
  /** Short identifier used in logs, COGS records, and asset labels. */
  readonly name: string;

  /**
   * isAvailable — returns true if the provider can be used right now.
   * Typically checks for required env vars. Called before enhance() to
   * skip providers that aren't configured without incurring API latency.
   */
  isAvailable(): boolean;

  /**
   * enhance — Run audio enhancement and return the result.
   *
   * @param input         Raw audio bytes (any format the provider accepts)
   * @param inputMimeType MIME type of the input (e.g. "audio/mpeg")
   * @param episodeId     Used for namespacing temp files and log context
   * @throws              Any error; the index catches and falls through to next provider
   */
  enhance(
    input:         Buffer,
    inputMimeType: string,
    episodeId:     string,
  ): Promise<EnhancementResult>;
}
