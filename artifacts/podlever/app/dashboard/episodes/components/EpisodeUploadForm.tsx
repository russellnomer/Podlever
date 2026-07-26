/**
 * EpisodeUploadForm.tsx — Client component for uploading a new episode
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-26 by agent (direct-to-GCS uploads — remove 25 MB wall)
 *
 * Upload flow (direct-to-cloud, no server body limits):
 *   1. Client validates type/size (audio or video, ≤300 MB)
 *   2. POST /api/uploads/sign → signed GCS PUT URL + HMAC token
 *   3. XHR PUT straight to GCS with a real progress bar
 *   4. finalizeDirectUploadAction creates the episode + triggers processing
 *
 * If the direct PUT fails (e.g. blocked network) and the file is ≤25 MB, we
 * fall back to the legacy server-action upload so small files always work.
 *
 * Errors are returned (not thrown) by the finalize action, so users see the
 * real reason instead of Next.js's masked production error.
 */

"use client";

import { useRef, useState, useTransition }  from "react";
import { useRouter }                        from "next/navigation";
import { uploadEpisodeAction, finalizeDirectUploadAction, getSignedUploadUrlAction } from "@/app/actions/episode.actions";
import { Mic, Upload, Loader2, AlertCircle, Film } from "lucide-react";

/** Max direct-upload size (matches /api/uploads/sign). */
const MAX_MB = 300;

/** Legacy server-action path cap (used only as a fallback). */
const LEGACY_MAX_MB = 25;

const ACCEPT =
  "audio/mp3,audio/mpeg,audio/mp4,audio/m4a,audio/wav,audio/ogg,audio/flac," +
  "video/mp4,video/quicktime,video/webm," +
  ".mp3,.m4a,.wav,.ogg,.flac,.mp4,.mov,.webm,.m4v";

const ALLOWED_EXT = /\.(mp3|m4a|wav|ogg|flac|mp4|mov|webm|m4v|mpeg|mpg)$/i;

interface EpisodeUploadFormProps {
  /** When true, shows a plan-limit reached message instead of the upload form. */
  atLimit?: boolean;
  /** User's current plan label (e.g. "Free trial"). Shown in the upgrade prompt. */
  planLabel?: string;
  /** Number of episodes used this period (or lifetime for trial tiers). */
  used?: number;
  /** Episode limit for this period (or lifetime for trial tiers). */
  limit?: number;
  /**
   * When true, the gate message uses "trial used" copy instead of "monthly limit".
   * Matches the `isTrialOnly` flag from UsageSummary.
   */
  isTrialOnly?: boolean;
}

/** XHR PUT with progress callback (fetch has no upload progress). */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload  = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`Storage upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Storage upload failed (network/CORS)"));
    xhr.send(file);
  });
}

export function EpisodeUploadForm({ atLimit, planLabel, used, limit, isTrialOnly }: EpisodeUploadFormProps) {
  const router                        = useRouter();
  const fileRef                       = useRef<HTMLInputElement>(null);
  const [error, setError]             = useState<string | null>(null);
  const [file, setFile]               = useState<File | null>(null);
  const [title, setTitle]             = useState("");
  const [progress, setProgress]       = useState<number | null>(null);
  const [phase, setPhase]             = useState<"idle" | "uploading" | "finalizing">("idle");
  const [isPending, startTransition]  = useTransition();

  const busy = phase !== "idle" || isPending;

  if (atLimit) {
    const headline = isTrialOnly ? "Free trial used" : "Monthly limit reached";
    const detail = isTrialOnly
      ? "Your free trial episode has been used. Upgrade to keep processing episodes."
      : `You've used ${used ?? 0}/${limit ?? 1} episodes on the ${planLabel ?? "Free"} plan this month.`;

    return (
      <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center">
          <span className="text-2xl">🔒</span>
        </div>
        <div>
          <p className="text-base font-semibold text-gray-900 mb-1">{headline}</p>
          <p className="text-sm text-gray-500">{detail}</p>
        </div>
        <a
          href="/pricing"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm
                     font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          Upgrade to upload more
        </a>
      </div>
    );
  }

  /** Client-side file validation before hitting the server. */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) { setFile(null); return; }
    setFile(f);
    setError(null);
    if (!ALLOWED_EXT.test(f.name)) {
      setError("Unsupported format. Use MP3, M4A, WAV, OGG, FLAC — or video: MP4, MOV, WEBM.");
    } else if (f.size > MAX_MB * 1024 * 1024) {
      setError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max is ${MAX_MB} MB.`);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || busy) return;
    setError(null);

    try {
      // ── 1. Get a signed URL (Server Action — /api is owned by a separate
      //       Express server in prod, so a Next.js /api route can't be used) ─
      setPhase("uploading");
      setProgress(0);
      const sign = await getSignedUploadUrlAction({
        filename:    file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes:   file.size,
      });
      if (!sign.ok) throw new Error(sign.error);

      // ── 2. PUT the file straight to cloud storage ───────────────────────
      let storageKey: string | null = sign.storageKey;
      let token: string | null      = sign.token;
      try {
        await putWithProgress(sign.uploadUrl, file, setProgress);
      } catch (putErr) {
        // Fallback: small files can still go through the server action.
        if (file.size <= LEGACY_MAX_MB * 1024 * 1024) {
          storageKey = null;
          token      = null;
        } else {
          throw putErr;
        }
      }

      // ── 3. Finalize (create episode + start processing) ─────────────────
      setPhase("finalizing");
      if (storageKey && token) {
        const fd = new FormData();
        fd.set("title", title);
        fd.set("storageKey", storageKey);
        fd.set("token", token);
        fd.set("filename", file.name);
        const result = await finalizeDirectUploadAction(fd);
        if (!result.ok) throw new Error(result.error);
        startTransition(() => router.push(`/dashboard/episodes/${result.episodeId}`));
      } else {
        // Legacy path (small files only)
        const fd = new FormData();
        fd.set("title", title);
        fd.set("audio", file);
        try {
          await uploadEpisodeAction(fd);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("NEXT_REDIRECT")) throw err;
        }
      }
    } catch (err) {
      setPhase("idle");
      setProgress(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const isVideoFile = file ? /\.(mp4|mov|webm|m4v|mpeg|mpg)$/i.test(file.name) : false;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Title */}
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
          Episode title <span className="text-red-500">*</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={255}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Ep 47 — Building in public with Jane Smith"
          disabled={busy}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm
                     text-gray-900 bg-white placeholder:text-gray-400 focus:border-indigo-500
                     focus:outline-none focus:ring-2 focus:ring-indigo-500/20
                     disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>

      {/* Media file */}
      <div>
        <label htmlFor="audio" className="block text-sm font-medium text-gray-700 mb-1">
          Audio or video file <span className="text-red-500">*</span>
          <span className="ml-2 font-normal text-gray-400">
            MP3, M4A, WAV, OGG, FLAC, MP4, MOV, WEBM — max {MAX_MB} MB
          </span>
        </label>

        <label
          htmlFor="audio"
          className={`flex flex-col items-center justify-center w-full h-36 rounded-xl border-2
                      border-dashed transition-colors cursor-pointer
                      ${file
                        ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                        : "border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-indigo-50 text-gray-500"
                      }
                      ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {file ? (
            <>
              {isVideoFile
                ? <Film className="w-7 h-7 mb-2 text-indigo-500" />
                : <Mic  className="w-7 h-7 mb-2 text-indigo-500" />}
              <span className="text-sm font-medium truncate max-w-xs px-4">{file.name}</span>
              <span className="text-xs text-indigo-500 mt-1">
                {(file.size / 1024 / 1024).toFixed(1)} MB — click to change
              </span>
            </>
          ) : (
            <>
              <Upload className="w-7 h-7 mb-2" />
              <span className="text-sm">Click to choose a file</span>
              <span className="text-xs mt-1">or drag and drop — video audio is extracted automatically</span>
            </>
          )}
          <input
            id="audio"
            ref={fileRef}
            name="audio"
            type="file"
            accept={ACCEPT}
            required
            disabled={busy}
            onChange={handleFileChange}
            className="sr-only"
          />
        </label>
      </div>

      {/* Progress bar */}
      {phase === "uploading" && progress !== null && (
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Uploading to secure storage…</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={busy || !!error || !file}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3
                   text-sm font-semibold text-white shadow-sm transition-colors
                   hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {phase === "uploading" ? "Uploading…" : "Starting processing…"}
          </>
        ) : (
          <>
            <Upload className="w-4 h-4" />
            Upload &amp; process
          </>
        )}
      </button>

      {busy && (
        <p className="text-center text-xs text-gray-500">
          {phase === "uploading"
            ? "Your file uploads directly to secure cloud storage — large files may take a few minutes."
            : "Almost there — creating your episode."}
        </p>
      )}
    </form>
  );
}
