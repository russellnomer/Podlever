/**
 * app/actions/settings.actions.ts — Account settings server actions
 *
 * Part of: PodLever
 * Created: 2026-08-04 by agent (Board directive — Sprint 1 🔴 persona system)
 *
 * Server Actions for the /dashboard/settings page.
 *
 * Currently:
 *   saveAudiencePersona — persist the user's chosen audience persona
 *
 * Gating:
 *   Free / Beta users can only select "general".
 *   Pro / Agency users get all 6 premium archetypes.
 *
 * SECURITY: server-only. requireBetaUser() enforces beta/paid access.
 *           Plan check happens server-side — the client cannot bypass it.
 */

"use server";

import { requireBetaUser }           from "@/providers/owner-guard";
import { db }                         from "@/db";
import { users }                      from "@/db/schema";
import { eq }                         from "drizzle-orm";
import { revalidatePath }             from "next/cache";
import { isPersonaPremium, PERSONAS } from "@/lib/personas";
import type { PersonaId }             from "@/lib/personas";

// ─── Action: save audience persona ────────────────────────────────────────────

export type SavePersonaResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * saveAudiencePersonaAction — Persist the user's selected audience persona.
 *
 * Called from the PersonaSelector component in /dashboard/settings.
 * Validates that the user's plan allows the selected persona before writing.
 *
 * @param personaId  One of the valid PersonaId values from lib/personas.ts
 */
export async function saveAudiencePersonaAction(
  personaId: string,
): Promise<SavePersonaResult> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const { userId, plan } = await requireBetaUser();

  // ── Validate persona ID ─────────────────────────────────────────────────────
  if (!PERSONAS[personaId as PersonaId]) {
    return { ok: false, error: "Invalid audience persona." };
  }

  // ── Plan gate: premium personas require Pro or Agency ──────────────────────
  const isPaid       = plan === "pro" || plan === "agency";
  const needsPremium = isPersonaPremium(personaId);

  if (needsPremium && !isPaid) {
    return {
      ok:    false,
      error: "Upgrade to Pro to unlock audience personas beyond General.",
    };
  }

  // ── Persist ─────────────────────────────────────────────────────────────────
  try {
    await db
      .update(users)
      .set({ audiencePersona: personaId })
      .where(eq(users.id, userId));

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");

    console.log(JSON.stringify({
      event:   "user.persona_updated",
      userId,
      persona: personaId,
      plan,
    }));

    return { ok: true };
  } catch (err) {
    console.error(JSON.stringify({
      event:  "user.persona_update.failed",
      userId,
      error:  String(err),
    }));
    return { ok: false, error: "Failed to save — please try again." };
  }
}
