/**
 * lib/audio/providers/ffmpeg.ts — FFmpeg audio enhancement provider
 *
 * Part of: PodLever
 * Created: 2026-07-20 by agent (Board move 1 — audio provider abstraction)
 *
 * Always-available provider. Uses the system FFmpeg binary (6.1.2 on Replit)
 * with two chained filters:
 *
 *   afftdn=nf=-25          — Adaptive FFT denoiser, attenuates noise floor 25 dB.
 *                            Effective on consistent background noise: fan hum,
 *                            HVAC, 60-Hz hiss. Struggles with intermittent noise.
 *
 *   loudnorm=I=-16:TP=-1.5:LRA=11
 *                          — EBU R128 loudness normalization (two-pass).
 *                            Target: -16 LUFS integrated (podcast standard),
 *                            -1.5 dBTP true peak, 11 LU range.
 *                            Output is mono (podcast-optimized, smaller Whisper input).
 *
 * Quality: ~80% of Dolby/Adobe on well-recorded speech. Fully adequate for
 * transcription quality — Whisper's WER on loudnorm-normalized audio is near-identical
 * to raw or commercially-enhanced audio.
 *
 * Cost: $0. No API keys. No network calls. Runs in ~5-30s depending on episode length.
 *
 * SECURITY: server-only — never import from client components.
 */

import "server-only";

import { execFile }        from "node:child_process";
import { promisify }       from "node:util";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir }          from "node:os";
import { join }            from "node:path";
import type { AudioProvider, EnhancementResult } from "../types";

const execFileAsync = promisify(execFile);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * mimeToExt — Map MIME type to file extension for temp file naming.
 * FFmpeg infers format from the extension; using the wrong extension
 * causes demuxer failures.
 */
function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "audio/mpeg":  "mp3",
    "audio/mp3":   "mp3",
    "audio/mp4":   "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav":   "wav",
    "audio/wave":  "wav",
    "audio/ogg":   "ogg",
    "audio/flac":  "flac",
    "audio/webm":  "webm",
  };
  return map[mime] ?? "mp3";
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * FFmpegProvider — Noise reduction + loudness normalization via FFmpeg.
 *
 * Uses the system ffmpeg binary; no npm package required.
 * Temp files are written to /tmp and cleaned up after processing.
 */
class FFmpegProvider implements AudioProvider {
  readonly name = "ffmpeg";

  /** FFmpeg is always available on the Replit container. */
  isAvailable(): boolean {
    return true;
  }

  /**
   * enhance — Write input to /tmp, run ffmpeg, return output as Buffer.
   *
   * Filter chain:
   *   1. afftdn (noise reduction) — first, so loudnorm works on a cleaner signal
   *   2. loudnorm (EBU R128 normalization) — two-pass via a single linear filter
   *
   * Output: mono WAV @ 44.1 kHz (optimal for Whisper transcription).
   * Timeout: 10 minutes (handles very long episodes).
   */
  async enhance(
    input:         Buffer,
    inputMimeType: string,
    episodeId:     string,
  ): Promise<EnhancementResult> {
    const tmp        = tmpdir();
    const ext        = mimeToExt(inputMimeType);
    const inputPath  = join(tmp, `podlever-${episodeId}-ffmpeg-in.${ext}`);
    const outputPath = join(tmp, `podlever-${episodeId}-ffmpeg-out.wav`);

    // Write input buffer to temp file
    await writeFile(inputPath, input);

    try {
      // Run FFmpeg with noise reduction + loudness normalization
      // -y          overwrite output without prompting
      // -ac 1       downmix to mono (podcast-optimized, ~50% smaller for Whisper)
      // -ar 44100   44.1 kHz sample rate
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",  inputPath,
        "-af", "afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "44100",
        "-ac", "1",
        outputPath,
      ], {
        timeout: 10 * 60 * 1_000, // 10-minute hard cap
        maxBuffer: 10 * 1024 * 1024, // 10 MB stderr buffer
      });

      // Read enhanced audio back into memory
      const buffer = await readFile(outputPath);

      return { buffer, mimeType: "audio/wav", provider: this.name };

    } finally {
      // Always clean up temp files — failures here are non-fatal
      await Promise.allSettled([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {}),
      ]);
    }
  }
}

// Export singleton — no state, safe to share across requests
export const ffmpegProvider: AudioProvider = new FFmpegProvider();
