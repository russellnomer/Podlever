/**
 * PersonaSelectorClient.tsx — Audience persona selector UI component
 *
 * Part of: PodLever
 * Created: 2026-08-04 by agent (Board directive — Sprint 1 🔴 persona system)
 *
 * Client component — handles optimistic selection state and calls the
 * saveAudiencePersonaAction server action on click.
 *
 * Shows all 7 personas (1 free + 6 premium). Locked personas are visible
 * but not selectable on the free plan — the lock icon + tooltip explains why.
 * This is intentional UX: the user can see what they're missing.
 */

"use client";

import { useState, useTransition } from "react";
import { Lock, CheckCircle2 }       from "lucide-react";
import { saveAudiencePersonaAction } from "@/app/actions/settings.actions";
import type { PersonaDef }           from "@/lib/personas";

interface PersonaSelectorClientProps {
  currentPersona: string;
  isPaidPlan:     boolean;
  personas:       PersonaDef[];
}

export function PersonaSelectorClient({
  currentPersona,
  isPaidPlan,
  personas,
}: PersonaSelectorClientProps) {
  const [selected,  setSelected]  = useState(currentPersona);
  const [saving,    setSaving]     = useState(false);
  const [error,     setError]      = useState<string | null>(null);
  const [success,   setSuccess]    = useState(false);
  const [, startTransition]       = useTransition();

  async function handleSelect(personaId: string) {
    const persona = personas.find((p) => p.id === personaId);
    if (!persona) return;

    // Free users cannot select premium personas
    if (persona.isPremium && !isPaidPlan) return;

    // Optimistic update
    const prev = selected;
    setSelected(personaId);
    setError(null);
    setSuccess(false);
    setSaving(true);

    startTransition(async () => {
      const result = await saveAudiencePersonaAction(personaId);
      setSaving(false);
      if (!result.ok) {
        // Revert on failure
        setSelected(prev);
        setError(result.error);
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Persona grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {personas.map((persona) => {
          const isLocked   = persona.isPremium && !isPaidPlan;
          const isSelected = selected === persona.id;

          return (
            <button
              key={persona.id}
              type="button"
              onClick={() => !isLocked && handleSelect(persona.id)}
              disabled={isLocked || saving}
              aria-pressed={isSelected}
              title={isLocked ? "Upgrade to Pro to unlock this persona" : undefined}
              className={[
                "relative flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all",
                isSelected
                  ? "border-indigo-400 bg-indigo-50 shadow-sm"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
                isLocked   ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              ].join(" ")}
            >
              {/* Emoji */}
              <span className="text-xl leading-none mt-0.5" aria-hidden="true">
                {persona.emoji}
              </span>

              {/* Label + description */}
              <div className="flex-1 min-w-0">
                <p className={[
                  "text-sm font-semibold",
                  isSelected ? "text-indigo-900" : "text-gray-800",
                ].join(" ")}>
                  {persona.label}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                  {persona.description}
                </p>
              </div>

              {/* State indicators */}
              {isLocked && (
                <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-1" aria-label="Pro required" />
              )}
              {isSelected && !isLocked && (
                <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" aria-label="Selected" />
              )}
            </button>
          );
        })}
      </div>

      {/* Status row */}
      <div className="h-5 flex items-center px-0.5">
        {saving && (
          <p className="text-xs text-gray-400 animate-pulse">Saving…</p>
        )}
        {success && !saving && (
          <p className="text-xs text-emerald-600 font-medium">
            ✓ Persona updated — applies to all future episodes
          </p>
        )}
        {error && !saving && (
          <p className="text-xs text-red-600">{error}</p>
        )}
      </div>
    </div>
  );
}
