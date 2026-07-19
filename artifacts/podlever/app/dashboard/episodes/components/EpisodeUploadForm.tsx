/**
 * EpisodeUploadForm.tsx — Client component for uploading a new episode
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #2 — Episode processing pipeline)
 *
 * Renders a form with title + audio file inputs. On submit it calls the
 * uploadEpisodeAction Server Action with a FormData payload. Shows loading
 * state and validation errors inline — no page reload until redirect.
 *
 * File constraints enforced both client-side (fast UX) and server-side (security):
 *   - Max size: 25 MB (OpenAI Whisper hard limit)
 *   - Accepted types: MP3, M4A, WAV, OGG, FLAC
 */

"use client";

import { useRef, useState, useTransition } from "react";
import { uploadEpisodeAction }             from "@/app/actions/episode.actions";
import { Mic, Upload, Loader2, AlertCircle } from "lucide-react";

/** Max file size shown in error messages (matches server-side constant). */
const MAX_MB = 25;

export function EpisodeUploadForm() {
  const formRef             = useRef<HTMLFormElement>(null);
  const [error, setError]   = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /** Client-side file validation before hitting the server. */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setFileName(null); return; }
    setFileName(file.name);
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is ${MAX_MB} MB.`);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      try {
        await uploadEpisodeAction(fd);
      } catch (err) {
        // next/navigation redirect throws — ignore it (redirect in flight)
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("NEXT_REDIRECT")) {
          setError(msg);
        }
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-6"
    >
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
          placeholder="e.g. Ep 47 — Building in public with Jane Smith"
          disabled={isPending}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm
                     placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none
                     focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>

      {/* Audio file */}
      <div>
        <label htmlFor="audio" className="block text-sm font-medium text-gray-700 mb-1">
          Audio file <span className="text-red-500">*</span>
          <span className="ml-2 font-normal text-gray-400">MP3, M4A, WAV, OGG, FLAC — max {MAX_MB} MB</span>
        </label>

        <label
          htmlFor="audio"
          className={`flex flex-col items-center justify-center w-full h-36 rounded-xl border-2
                      border-dashed transition-colors cursor-pointer
                      ${fileName
                        ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                        : "border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-indigo-50 text-gray-500"
                      }
                      ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {fileName ? (
            <>
              <Mic className="w-7 h-7 mb-2 text-indigo-500" />
              <span className="text-sm font-medium truncate max-w-xs px-4">{fileName}</span>
              <span className="text-xs text-indigo-500 mt-1">Click to change</span>
            </>
          ) : (
            <>
              <Upload className="w-7 h-7 mb-2" />
              <span className="text-sm">Click to choose a file</span>
              <span className="text-xs mt-1">or drag and drop</span>
            </>
          )}
          <input
            id="audio"
            name="audio"
            type="file"
            accept="audio/mp3,audio/mpeg,audio/mp4,audio/m4a,audio/wav,audio/ogg,audio/flac,.mp3,.m4a,.wav,.ogg,.flac"
            required
            disabled={isPending}
            onChange={handleFileChange}
            className="sr-only"
          />
        </label>
      </div>

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
        disabled={isPending || !!error}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3
                   text-sm font-semibold text-white shadow-sm transition-colors
                   hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Upload className="w-4 h-4" />
            Upload &amp; process
          </>
        )}
      </button>

      {isPending && (
        <p className="text-center text-xs text-gray-500">
          Uploading your audio — hang tight, this may take a moment.
        </p>
      )}
    </form>
  );
}
