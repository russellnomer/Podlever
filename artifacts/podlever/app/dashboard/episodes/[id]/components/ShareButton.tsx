/**
 * app/dashboard/episodes/[id]/components/ShareButton.tsx
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — shareable episode links)
 *
 * "use client" — toggles sharing on/off, copies share URL to clipboard.
 * Calls POST /api/episodes/[id]/share-token to generate a token.
 * Calls DELETE /api/episodes/[id]/share-token to revoke sharing.
 */

"use client";

import { useState }                  from "react";
import { Share2, Link2, X, Check, Loader2 } from "lucide-react";

interface ShareButtonProps {
  episodeId:          string;
  /** Existing token if sharing was already enabled. */
  initialShareToken?: string | null;
}

export function ShareButton({ episodeId, initialShareToken }: ShareButtonProps) {
  const [shareToken, setShareToken] = useState<string | null>(initialShareToken ?? null);
  const [loading,    setLoading   ] = useState(false);
  const [copied,     setCopied    ] = useState(false);

  const shareUrl = shareToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${shareToken}`
    : null;

  async function enableSharing() {
    setLoading(true);
    try {
      const res  = await fetch(`/api/episodes/${episodeId}/share-token`, { method: "POST" });
      const data = await res.json() as { shareToken?: string };
      if (data.shareToken) setShareToken(data.shareToken);
    } catch {
      /* ignore — button stays in same state */
    } finally {
      setLoading(false);
    }
  }

  async function disableSharing() {
    setLoading(true);
    try {
      await fetch(`/api/episodes/${episodeId}/share-token`, { method: "DELETE" });
      setShareToken(null);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  // ── Sharing active ─────────────────────────────────────────────────────────
  if (shareToken) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 max-w-xs truncate font-mono bg-gray-100 rounded px-2 py-0.5">
          {shareUrl}
        </span>
        <button
          type="button"
          onClick={copyUrl}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium
                     text-indigo-700 hover:bg-indigo-100 transition-colors"
        >
          {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={disableSharing}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium
                     text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
          title="Disable sharing"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          Disable
        </button>
      </div>
    );
  }

  // ── Sharing inactive ────────────────────────────────────────────────────────
  return (
    <button
      type="button"
      onClick={enableSharing}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5
                 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
    >
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <Share2 className="w-4 h-4" />
      }
      {loading ? "Enabling…" : "Share episode"}
    </button>
  );
}
