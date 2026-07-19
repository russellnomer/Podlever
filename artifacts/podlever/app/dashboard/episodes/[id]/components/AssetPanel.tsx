/**
 * app/dashboard/episodes/[id]/components/AssetPanel.tsx
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — episode detail upgrade)
 *
 * "use client" — handles copy + exposes textarea id for regeneration.
 * Renders one text asset section with Copy, Regenerate, and PDF buttons.
 */

"use client";

import { BookOpen, Copy, FileDown, FileText, Gift, Share2 } from "lucide-react";
import { RegenerateButton } from "./RegenerateButton";
import type { AssetType }   from "@/db/schema";

// ─── Asset display config ─────────────────────────────────────────────────────

const ASSET_CONFIG: Partial<Record<AssetType, {
  label:    string;
  icon:     React.ComponentType<{ className?: string }>;
  rows:     number;
  canRegen: boolean;
}>> = {
  transcript:       { label: "Transcript",       icon: FileText,  rows: 20, canRegen: false },
  show_notes:       { label: "Show Notes",        icon: BookOpen,  rows: 14, canRegen: true  },
  blog_post:        { label: "Blog Post",         icon: BookOpen,  rows: 18, canRegen: true  },
  social_post:      { label: "Social Copy",       icon: Share2,    rows: 12, canRegen: true  },
  guest_media_pack: { label: "Guest Media Pack",  icon: Gift,      rows: 14, canRegen: true  },
};

interface AssetPanelProps {
  episodeId:     string;
  assetType:     AssetType;
  content:       string;
  canRegen:      boolean;
  showPdfButton: boolean;
}

export function AssetPanel({
  episodeId,
  assetType,
  content,
  canRegen,
  showPdfButton,
}: AssetPanelProps) {
  const cfg = ASSET_CONFIG[assetType];
  if (!cfg) return null;

  const Icon       = cfg.icon;
  const textareaId = `asset-${assetType}`;

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-800">{cfg.label}</h3>
        </div>
        <div className="flex items-center gap-1">
          {/* Regenerate — Pro/Agency only */}
          {cfg.canRegen && (
            <RegenerateButton
              episodeId={episodeId}
              assetType={assetType}
              textareaId={textareaId}
              canRegen={canRegen}
            />
          )}

          {/* PDF download — guest media pack only */}
          {showPdfButton && (
            <a
              href={`/api/episodes/${episodeId}/guest-pack`}
              download
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium
                         text-indigo-600 hover:bg-indigo-50 transition-colors"
              title="Download branded PDF"
            >
              <FileDown className="w-3 h-3" />
              PDF
            </a>
          )}

          {/* Copy */}
          <button
            type="button"
            onClick={async () => {
              const el = document.getElementById(textareaId) as HTMLTextAreaElement | null;
              await navigator.clipboard.writeText(el?.value ?? content);
            }}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium
                       text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <Copy className="w-3 h-3" />
            Copy
          </button>
        </div>
      </header>
      <textarea
        id={textareaId}
        readOnly
        defaultValue={content}
        rows={cfg.rows}
        className="w-full resize-y p-4 text-sm text-gray-700 leading-relaxed
                   font-mono bg-white focus:outline-none"
      />
    </section>
  );
}
