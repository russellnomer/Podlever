/**
 * lib/audio/transcode.ts — Prepare any upload for transcription
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (large uploads — remove the 25 MB wall)
 *
 * OpenAI's transcription API caps requests at 25 MB. Real episodes (and video
 * recordings) are far bigger, so before transcription we:
 *
 *   1. ffprobe   — measure the real duration (also fixes COGS accounting,
 *                  which previously guessed duration from file size)
 *   2. ffmpeg    — strip video, downmix to mono 16 kHz, encode 32 kbps MP3
 *                  (speech-optimized; Whisper WER is unaffected by this rate).
 *                  A 1-hour episode lands at ~14 MB.
 *   3. segment   — if the compressed file still exceeds the API cap
 *                  (~100+ minutes), split into 45-minute chunks; callers
 *                  transcribe each and join the text.
 *
 * Runs on the system FFmpeg binary already present on Replit (used by the
 * enhancement providers). No API keys, no network calls.
 *
 * SECURITY: server-only — never import from client components.
 */

import "server-only";

import { getFfmpegPath, getFfprobePath } from "@/lib/audio/binaries";
import { execFile }                    from "node:child_process";
import { promisify }                   from "node:util";
import { writeFile, readFile, unlink, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir }                      from "node:os";
import { join }                        from "node:path";

const execFileAsync = promisify(execFile);

/** OpenAI transcription request cap is 25 MB; stay safely under it. */
const TRANSCRIBE_SAFE_BYTES = 24 * 1024 * 1024;

/** Segment length when chunking (45 min ≈ 10.8 MB at 32 kbps mono). */
const SEGMENT_SECONDS = 45 * 60;

export interface TranscriptionInput {
  /** One or more ≤24 MB MP3 buffers, in playback order. */
  chunks: Buffer[];
  /** Real duration in seconds (from ffprobe), or null if probing failed. */
  durationSeconds: number | null;
}

/** Map a file extension to a container FFmpeg can demux. */
const KNOWN_EXTENSIONS = new Set([
  "mp3", "m4a", "wav", "ogg", "flac", "webm",
  "mp4", "mov", "m4v", "mpeg", "mpg",
]);

/** ffprobe the duration of a media file (seconds), or null on failure. */
async function probeDurationSeconds(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(getFfprobePath(), [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/**
 * prepareForTranscription — Convert any supported upload (audio OR video, any
 * size) into one or more ≤24 MB speech-optimized MP3 buffers ready for the
 * transcription API.
 *
 * @param buffer  Raw uploaded bytes
 * @param ext     File extension from the storage key (drives the demuxer)
 * @returns       Compressed chunk(s) + real duration
 * @throws        If FFmpeg cannot decode the file at all
 */
export async function prepareForTranscription(
  buffer: Buffer,
  ext: string,
): Promise<TranscriptionInput> {
  const safeExt  = KNOWN_EXTENSIONS.has(ext.toLowerCase()) ? ext.toLowerCase() : "mp3";
  const workDir  = await mkdtemp(join(tmpdir(), "podlever-transcode-"));
  const inPath   = join(workDir, `input.${safeExt}`);
  const outPath  = join(workDir, "speech.mp3");

  try {
    await writeFile(inPath, buffer);

    const durationSeconds = await probeDurationSeconds(inPath);

    // Strip video (-vn), mono (-ac 1), 16 kHz (-ar 16000), 32 kbps MP3 —
    // the standard speech-transcription preprocessing profile.
    await execFileAsync(getFfmpegPath(), [
      "-y", "-i", inPath,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
      "-f", "mp3", outPath,
    ], { maxBuffer: 16 * 1024 * 1024 });

    const compressed = await readFile(outPath);

    if (compressed.length <= TRANSCRIBE_SAFE_BYTES) {
      return { chunks: [compressed], durationSeconds };
    }

    // Still too big (100+ minute episode) — split into fixed-length segments.
    const segmentPattern = join(workDir, "segment-%03d.mp3");
    await execFileAsync(getFfmpegPath(), [
      "-y", "-i", outPath,
      "-f", "segment",
      "-segment_time", String(SEGMENT_SECONDS),
      "-c", "copy",
      segmentPattern,
    ], { maxBuffer: 16 * 1024 * 1024 });

    const segmentFiles = (await readdir(workDir))
      .filter((f) => f.startsWith("segment-") && f.endsWith(".mp3"))
      .sort();
    if (segmentFiles.length === 0) {
      throw new Error("FFmpeg segmentation produced no output files");
    }

    const chunks: Buffer[] = [];
    for (const f of segmentFiles) {
      chunks.push(await readFile(join(workDir, f)));
    }
    return { chunks, durationSeconds };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    // Belt-and-braces for older Node fallbacks
    await unlink(inPath).catch(() => {});
  }
}
