/**
 * app/components/StudioUploader.tsx — Upload → process → results UI (Client Component)
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (Phase 1B — pipeline engine)
 *
 * HUMAN REVIEW NOTES:
 * This is the browser surface an owner (or invited tester) uses to prove the app
 * works end-to-end: pick a recording, click Generate, watch it run, read the
 * transcript + show notes + social pack that come back.
 *
 * It calls the `uploadAndProcessAction` Server Action directly (no REST layer),
 * consistent with the Phase 1A "Server Actions only" decision. All heavy lifting
 * (transcription, writing, persistence, FSM) happens server-side; this component
 * only manages upload state and renders results.
 */

"use client";

import { useState, useRef } from "react";
import { uploadAndProcessAction, type UploadAndProcessResult } from "@/app/actions/pipeline.actions";

type Phase = "idle" | "uploading" | "done" | "error";

export function StudioUploader() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<Extract<UploadAndProcessResult, { ok: true }> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a recording first.");
      setPhase("error");
      return;
    }
    setPhase("uploading");
    setError("");
    setResult(null);
    try {
      const res = await uploadAndProcessAction(fd);
      if (res.ok) {
        setResult(res);
        setPhase("done");
      } else {
        setError(res.error);
        setPhase("error");
      }
    } catch {
      setError("Something went wrong reaching the server. Try again.");
      setPhase("error");
    }
  }

  function reset() {
    setPhase("idle");
    setResult(null);
    setError("");
    setFileName("");
    formRef.current?.reset();
  }

  return (
    <div className="space-y-6">
      {/* Uploader card */}
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4"
      >
        <div className="space-y-1">
          <h2 className="text-white font-semibold">Turn a recording into assets</h2>
          <p className="text-zinc-500 text-sm">
            Upload an episode recording (MP3, M4A, WAV, MP4). PodLever transcribes it and
            writes your show notes and social pack.
          </p>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            name="title"
            placeholder="Episode title (optional)"
            className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none"
            disabled={phase === "uploading"}
          />

          <label className="block">
            <span className="sr-only">Recording file</span>
            <input
              type="file"
              name="file"
              accept="audio/*,video/mp4"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              disabled={phase === "uploading"}
              className="block w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-zinc-800 file:text-zinc-200 file:text-sm hover:file:bg-zinc-700 file:cursor-pointer"
            />
          </label>
          {fileName && (
            <p className="text-xs text-zinc-500">Selected: <span className="text-zinc-300 font-mono">{fileName}</span></p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={phase === "uploading"}
            className="py-2.5 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-sm transition-colors"
          >
            {phase === "uploading" ? "Generating…" : "Generate assets"}
          </button>
          {phase === "done" && (
            <button
              type="button"
              onClick={reset}
              className="py-2.5 px-4 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 text-sm transition-colors"
            >
              New recording
            </button>
          )}
        </div>

        {phase === "uploading" && (
          <div className="flex items-center gap-3 text-sm text-emerald-400">
            <span className="inline-block w-4 h-4 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
            Transcribing and writing… this runs live against Deepgram + Claude and can take up to a minute.
          </div>
        )}

        {phase === "error" && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </form>

      {/* Results */}
      {phase === "done" && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs">✓</span>
            <p className="text-zinc-300 text-sm">
              Generated from <span className="text-white font-medium">{result.episodeTitle}</span> —
              transcript {(result.transcript.durationSeconds).toFixed(0)}s, confidence {result.transcript.confidence.toFixed(2)}.
            </p>
          </div>

          <ResultPanel title="📝 Show notes" body={result.showNotes.content} />
          <ResultPanel title="📣 Social pack" body={result.socialPosts.content} />
          <ResultPanel title="🎙️ Full transcript" body={result.transcript.content} collapsed />
        </div>
      )}
    </div>
  );
}

function ResultPanel({ title, body, collapsed }: { title: string; body: string; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-zinc-900"
      >
        <span className="text-white font-medium text-sm">{title}</span>
        <div className="flex items-center gap-3">
          <CopyButton text={body} />
          <span className="text-zinc-500 text-xs">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <pre className="px-5 py-4 text-sm text-zinc-300 whitespace-pre-wrap font-sans border-t border-zinc-800 leading-relaxed">
          {body}
        </pre>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
    >
      {copied ? "copied" : "copy"}
    </span>
  );
}
