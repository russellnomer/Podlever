/**
 * lib/magic-bytes.ts — Content sniffing for uploaded media files
 *
 * Part of: PodLever
 * Created: 2026-07-27 by agent (Security sprint — PR #22)
 *
 * WHY: MIME type and file extension are both attacker-controlled. The only
 * trustworthy signal is the file's actual leading bytes. This module checks
 * that an uploaded object *really is* one of the media container formats we
 * process, before we create an episode and feed it to the ffmpeg/OpenAI
 * pipeline (OWASP: unrestricted file upload).
 *
 * Design notes:
 *   - Pure functions, no I/O — callers fetch the head bytes (64 is plenty).
 *   - Validation is by FORMAT FAMILY, not exact extension: an .m4a that is
 *     really an MP4 container is fine (same demuxer); a .mp3 that is really
 *     a Windows executable is not.
 *   - MP3 is the loosest format (raw frame sync, optional ID3 tag). We accept
 *     "ID3" or a 0xFFEx frame-sync anywhere in the first 64 bytes to tolerate
 *     junk prefixes that real-world encoders produce.
 */

/** Media families we can demux. Keys align with ALLOWED_UPLOAD_EXTENSIONS. */
export type MediaFamily = "mp3" | "wav" | "ogg" | "flac" | "mp4" | "webm" | "mpegps";

/** Extension (lowercase, no dot) → format families acceptable for it. */
const EXT_FAMILIES: Record<string, MediaFamily[]> = {
  mp3:  ["mp3"],
  m4a:  ["mp4"],          // M4A is an MP4 container
  wav:  ["wav"],
  ogg:  ["ogg"],
  flac: ["flac", "ogg"],  // FLAC also ships inside Ogg containers
  mp4:  ["mp4"],
  mov:  ["mp4"],          // QuickTime uses the same ISO BMFF ftyp layout
  m4v:  ["mp4"],
  webm: ["webm"],
  mpeg: ["mpegps", "mp3"], // .mpeg sometimes used for MPEG audio
  mpg:  ["mpegps", "mp3"],
};

/** ASCII helper. */
function ascii(buf: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > buf.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** Detect which media families the leading bytes match. */
export function detectMediaFamilies(head: Uint8Array): MediaFamily[] {
  const found: MediaFamily[] = [];

  // WAV — "RIFF" .... "WAVE"
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WAVE")) found.push("wav");

  // OGG — "OggS"
  if (ascii(head, 0, "OggS")) found.push("ogg");

  // FLAC — "fLaC"
  if (ascii(head, 0, "fLaC")) found.push("flac");

  // ISO BMFF (MP4/M4A/MOV/M4V) — "ftyp" at offset 4
  if (ascii(head, 4, "ftyp")) found.push("mp4");

  // WebM/Matroska — EBML header 0x1A 0x45 0xDF 0xA3
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    found.push("webm");
  }

  // MPEG program stream — pack header 00 00 01 BA (or sequence header 00 00 01 B3)
  if (
    head.length >= 4 &&
    head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 &&
    (head[3] === 0xba || head[3] === 0xb3)
  ) {
    found.push("mpegps");
  }

  // MP3 — "ID3" tag, or an MPEG audio frame sync (0xFF 0xEx/0xFx) within the
  // first 64 bytes (some encoders emit small junk/padding prefixes).
  if (ascii(head, 0, "ID3")) {
    found.push("mp3");
  } else {
    const limit = Math.min(head.length - 1, 64);
    for (let i = 0; i < limit; i++) {
      if (head[i] === 0xff && (head[i + 1]! & 0xe0) === 0xe0) {
        found.push("mp3");
        break;
      }
    }
  }

  return found;
}

/** Result of validating an upload's leading bytes against its extension. */
export type MagicByteResult =
  | { ok: true; family: MediaFamily }
  | { ok: false; reason: string };

/**
 * validateMediaMagicBytes — Does this file's content match its claimed extension?
 *
 * @param head Leading bytes of the file (>= 12 bytes; 64 recommended)
 * @param ext  Claimed extension, lowercase, no dot (e.g. "mp3")
 */
export function validateMediaMagicBytes(head: Uint8Array, ext: string): MagicByteResult {
  const allowed = EXT_FAMILIES[ext];
  if (!allowed) {
    return { ok: false, reason: `Unsupported extension ".${ext}".` };
  }
  if (head.length < 12) {
    return { ok: false, reason: "File is too small to be a valid audio or video file." };
  }
  const detected = detectMediaFamilies(head);
  const match = detected.find((f) => allowed.includes(f));
  if (match) return { ok: true, family: match };
  return {
    ok: false,
    reason:
      detected.length > 0
        ? `File content (${detected.join("/")}) does not match its ".${ext}" extension.`
        : `File does not look like a supported audio or video format.`,
  };
}
