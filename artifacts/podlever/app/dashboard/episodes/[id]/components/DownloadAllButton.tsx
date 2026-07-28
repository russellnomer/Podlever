/**
 * app/dashboard/episodes/[id]/components/DownloadAllButton.tsx
 *
 * Part of: PodLever
 * Created: 2026-07-28
 * Last modified: 2026-07-28 (fix: bare <a download> silently saved error JSON
 *                as a file literally named "zip" — support request 2026-07-28)
 *
 * "use client" — downloads the episode ZIP via fetch so that:
 *   1. HTTP errors show a visible message instead of downloading error JSON.
 *   2. The saved file always gets the server's Content-Disposition filename.
 *   3. If the full ZIP fails (very large audio), we automatically retry
 *      text-only (?audio=0) so the user still gets their content.
 */

"use client";

import { useState }                       from "react";
import { Archive, Loader2, AlertCircle, FileText } from "lucide-react";

interface DownloadAllButtonProps {
  episodeId: string;
}

/** Extract filename="..." from a Content-Disposition header. */
function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

/** Trigger a browser download for a fetched blob. */
function saveBlob(blob: Blob, filename: string): void {
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href      = url;
  link.download  = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function DownloadAllButton({ episodeId }: DownloadAllButtonProps) {
  const [loading,  setLoading ] = useState(false);
  const [error,    setError   ] = useState<string | null>(null);
  const [textOnly, setTextOnly] = useState(false);

  async function fetchZip(includeAudio: boolean): Promise<Response> {
    const suffix = includeAudio ? "" : "?audio=0";
    return await fetch(`/rpc/episodes/${episodeId}/zip${suffix}`);
  }

  async function handleDownload() {
    setLoading(true);
    setError(null);
    setTextOnly(false);
    try {
      let res = await fetchZip(true);

      // Full ZIP failed (e.g. very large audio) → retry without audio so the
      // user still gets transcript/notes/posts instead of a dead end.
      if (!res.ok && res.status >= 500) {
        res = await fetchZip(false);
        if (res.ok) setTextOnly(true);
      }

      if (!res.ok) {
        let message = `Download failed (HTTP ${res.status}).`;
        try {
          const data = await res.json() as { error?: string };
          if (data.error) message = data.error;
        } catch { /* non-JSON error body */ }
        setError(message);
        return;
      }

      const blob     = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get("Content-Disposition"),
        `podlever-${episodeId}.zip`,
      );
      saveBlob(blob, filename);
    } catch {
      setError("Download failed — please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium
                   text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-60"
        title="Download all assets as ZIP (includes transcript PDF)"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
        {loading ? "Preparing…" : "Download all"}
      </button>
      {error && (
        <span className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </span>
      )}
      {textOnly && !error && (
        <span className="flex items-center gap-1 text-xs text-amber-600">
          <FileText className="w-3.5 h-3.5" />
          Audio was too large to bundle — downloaded text assets only.
        </span>
      )}
    </div>
  );
}
