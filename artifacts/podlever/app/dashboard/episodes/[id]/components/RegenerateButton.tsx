/**
 * app/dashboard/episodes/[id]/components/RegenerateButton.tsx
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — revision button)
 *
 * "use client" — calls regenerateAsset Server Action and updates the parent
 * textarea with the new content in-place (no full page reload).
 *
 * Props:
 *   episodeId  — target episode UUID
 *   assetType  — which asset to regenerate
 *   textareaId — DOM id of the textarea to update on success
 *   canRegen   — false = show disabled button (plan gate, set server-side)
 */

"use client";

import { useState }           from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { regenerateAsset }    from "@/app/actions/regenerate.actions";
import type { AssetType }     from "@/db/schema";

interface RegenerateButtonProps {
  episodeId:   string;
  assetType:   AssetType;
  textareaId:  string;
  canRegen:    boolean;
}

export function RegenerateButton({
  episodeId,
  assetType,
  textareaId,
  canRegen,
}: RegenerateButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error,   setError  ] = useState<string | null>(null);

  if (!canRegen) {
    return (
      <span
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium
                   text-gray-300 cursor-not-allowed select-none"
        title="Upgrade to Pro to regenerate assets"
      >
        <RefreshCw className="w-3 h-3" />
        Regenerate
      </span>
    );
  }

  async function handleRegen() {
    setLoading(true);
    setError(null);

    const result = await regenerateAsset(episodeId, assetType);

    if (result.success) {
      // Update the textarea directly without a full page reload
      const el = document.getElementById(textareaId) as HTMLTextAreaElement | null;
      if (el) el.value = result.content;
    } else {
      setError(result.error);
    }

    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
      <button
        type="button"
        onClick={handleRegen}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium
                   text-violet-600 hover:bg-violet-50 transition-colors disabled:opacity-50
                   disabled:cursor-not-allowed"
        title="Generate a new version of this asset"
      >
        {loading
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <RefreshCw className="w-3 h-3" />
        }
        {loading ? "Generating…" : "Regenerate"}
      </button>
    </div>
  );
}
