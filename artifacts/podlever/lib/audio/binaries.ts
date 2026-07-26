/**
 * lib/audio/binaries.ts — Resolve ffmpeg/ffprobe executables reliably
 *
 * Part of: PodLever
 * Created: 2026-07-26
 * Last modified: 2026-07-26 by agent (pipeline hardening)
 *
 * WHY THIS EXISTS: the processing pipeline used to call bare `ffmpeg` /
 * `ffprobe` and rely on them being on PATH. That held in the Replit
 * workspace but NOT in published deployments, where the pipeline died with
 * ENOENT and episodes sat in "processing" forever. We now bundle static
 * binaries via @ffmpeg-installer/ffmpeg and @ffprobe-installer/ffprobe and
 * fall back to system binaries only when the bundled ones are unavailable.
 *
 * pnpm skips dependency postinstall scripts by default, so the bundled
 * binaries may land without the executable bit — ensureExecutable() fixes
 * that at runtime (chmod is idempotent and cheap).
 *
 * SECURITY: server-only. Paths come from node_modules, never user input.
 */

import "server-only";
import { accessSync, chmodSync, constants } from "node:fs";

function ensureExecutable(path: string): string {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    try { chmodSync(path, 0o755); } catch { /* fall through — spawn will surface the real error */ }
  }
  return path;
}

/** Lazily-resolved absolute path to ffmpeg (bundled first, PATH fallback). */
let ffmpegPathCache: string | null = null;
export function getFfmpegPath(): string {
  if (ffmpegPathCache) return ffmpegPathCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { path } = require("@ffmpeg-installer/ffmpeg") as { path: string };
    ffmpegPathCache = ensureExecutable(path);
  } catch {
    ffmpegPathCache = "ffmpeg"; // last resort: system PATH
  }
  return ffmpegPathCache;
}

/** Lazily-resolved absolute path to ffprobe (bundled first, PATH fallback). */
let ffprobePathCache: string | null = null;
export function getFfprobePath(): string {
  if (ffprobePathCache) return ffprobePathCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { path } = require("@ffprobe-installer/ffprobe") as { path: string };
    ffprobePathCache = ensureExecutable(path);
  } catch {
    ffprobePathCache = "ffprobe";
  }
  return ffprobePathCache;
}
