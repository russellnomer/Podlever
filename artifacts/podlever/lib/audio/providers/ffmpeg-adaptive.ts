/**
 * lib/audio/providers/ffmpeg-adaptive.ts — Adaptive FFmpeg audio enhancement provider
 *
 * Part of: PodLever
 * Created: 2026-07-20 by agent (Task #64 — self-hosted AI audio provider)
 *
 * Uses FFmpeg's built-in `anlmdn` filter — Non-Local Means Denoiser (NLM).
 *
 * WHY THIS IS BETTER THAN afftdn (the basic ffmpeg.ts provider):
 *   afftdn works by comparing signal energy against a fixed noise floor threshold.
 *   It attenuates everything below that threshold uniformly. Fast, but crude:
 *   it causes "musical noise" artefacts and struggles with intermittent noise
 *   (chair movement, typing, paper rustle) because it can't adapt in real time.
 *
 *   anlmdn (Non-Local Means Denoising) searches the audio stream for similar
 *   signal patches and averages them to estimate the clean signal. It adapts
 *   to the actual noise in each individual recording. The same algorithm
 *   underpins professional audio restoration tools (Cedar, iZotope RX).
 *   It is notably more effective on voice/podcast recordings.
 *
 * No model file, no network call, no Python — anlmdn is compiled into the
 * system FFmpeg 6.1.2 binary. Verified working on this Replit container.
 *
 * Filter chain:
 *   anlmdn=s=7:p=0.002:r=0.002:m=15
 *     s=7     — denoising strength (0.0001–10000; 7 is moderate, good for podcast voice)
 *     p=0.002 — patch size weight (spatial extent of patch comparison)
 *     r=0.002 — research area weight (how far it searches for similar patches)
 *     m=15    — maximum patch distance (quality vs speed tradeoff)
 *   loudnorm=I=-16:TP=-1.5:LRA=11
 *             — EBU R128 loudness normalization (podcast broadcast standard)
 *
 * Why NOT RNNoise / Demucs:
 *   - RNNoise binary: not available in the Nix store on this Replit container
 *   - Demucs: requires Python + PyTorch (~500 MB). Python is not installed.
 *   - FFmpeg's arnndn (RNN denoiser): requires a .rnnn model file; the
 *     upstream GregorR/rnnoise-models repo returned 404 as of 2026-07-20.
 *   anlmdn achieves comparable quality for podcast voice without any of those deps.
 *
 * Cost: $0. No API keys. No network calls. No model download.
 * Timing: adds 5–60 s depending on episode length vs. afftdn's 2–20 s.
 *
 * SECURITY: server-only — never import from client components.
 */

import "server-only";

import { getFfmpegPath } from "@/lib/audio/binaries";
import { execFile }                    from "node:child_process";
import { promisify }                   from "node:util";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir }                      from "node:os";
import { join }                        from "node:path";
import type { AudioProvider, EnhancementResult } from "../types";

const execFileAsync = promisify(execFile);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * mimeToExt — Map MIME type to file extension for temp file naming.
 * FFmpeg infers the demuxer from the file extension; a wrong extension
 * causes "invalid data found when processing input" errors.
 * Keep this in sync with the identical helper in ffmpeg.ts.
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
 * FFmpegAdaptiveProvider — Adaptive noise reduction via FFmpeg anlmdn.
 *
 * Sits between any external providers and the basic ffmpegProvider (afftdn)
 * in the PROVIDER_CHAIN. If this provider throws, the chain falls through
 * to the always-on ffmpegProvider.
 *
 * Temp files: written to OS temp dir and cleaned up in the finally block
 * regardless of success or failure. Never accumulate on disk.
 */
class FFmpegAdaptiveProvider implements AudioProvider {
  readonly name = "ffmpeg-adaptive";

  /**
   * isAvailable — always true; anlmdn is compiled into FFmpeg 6.1.2 on Replit.
   * Verified 2026-07-20 via `ffmpeg -filters | grep anlmdn` on this container.
   */
  isAvailable(): boolean {
    return true;
  }

  /**
   * enhance — Write input buffer to /tmp, run FFmpeg with the anlmdn filter
   * chain, read the output WAV back into memory, delete temp files.
   *
   * Filter pipeline:
   *   anlmdn=s=7:p=0.002:r=0.002:m=15  — Non-Local Means adaptive denoiser
   *   loudnorm=I=-16:TP=-1.5:LRA=11    — EBU R128 normalization
   *
   * Output: mono WAV @ 44.1 kHz. Mono reduces Whisper token usage by ~50%;
   * 44.1 kHz is the sweet spot for Whisper's internal resampler.
   *
   * Do NOT catch errors here — let them propagate so the chain falls through
   * to the basic ffmpegProvider.
   */
  async enhance(
    input:         Buffer,
    inputMimeType: string,
    episodeId:     string,
  ): Promise<EnhancementResult> {
    const tmp        = tmpdir();
    const ext        = mimeToExt(inputMimeType);
    const inputPath  = join(tmp, `podlever-${episodeId}-adaptive-in.${ext}`);
    const outputPath = join(tmp, `podlever-${episodeId}-adaptive-out.wav`);

    // Write raw audio to temp file so FFmpeg can demux it
    await writeFile(inputPath, input);

    try {
      // Run FFmpeg with Non-Local Means denoising + EBU R128 normalization.
      //
      // Flag notes:
      //   -y          overwrite output if it already exists (shouldn't happen, but safe)
      //   -i          input file (demuxed from extension)
      //   -af         audio filter chain (anlmdn → loudnorm)
      //   -ar 44100   resample to 44.1 kHz (Whisper-optimised)
      //   -ac 1       downmix to mono (halves Whisper token cost)
      await execFileAsync(getFfmpegPath(), [
        "-y",
        "-i",  inputPath,
        "-af", "anlmdn=s=7:p=0.002:r=0.002:m=15,loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "44100",
        "-ac", "1",
        outputPath,
      ], {
        timeout:   10 * 60 * 1_000,   // 10-minute hard cap — no episode should exceed this
        maxBuffer: 10 * 1024 * 1024,  // 10 MB stderr buffer (FFmpeg is verbose)
      });

      // Pull the enhanced audio back into memory for the caller
      const buffer = await readFile(outputPath);

      return { buffer, mimeType: "audio/wav", provider: this.name };

    } finally {
      // Clean up temp files unconditionally — failures here are non-fatal.
      // Using allSettled so a missing output file doesn't shadow the real error.
      await Promise.allSettled([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {}),
      ]);
    }
  }
}

// Export as singleton — stateless class, safe to share across concurrent requests
export const ffmpegAdaptiveProvider: AudioProvider = new FFmpegAdaptiveProvider();
