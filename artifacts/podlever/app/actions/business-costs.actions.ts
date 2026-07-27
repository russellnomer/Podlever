/**
 * app/actions/business-costs.actions.ts — Owner-only fixed-cost ledger actions
 *
 * Part of: PodLever
 * Created: 2026-07-27 by agent (founder request — full cost picture on /admin/cogs)
 *
 * The founder enters recurring fixed costs once (Replit, GoDaddy, Google
 * Workspace, Viktor, etc.); /admin/cogs then shows true monthly burn and
 * margin, not just per-episode AI COGS.
 *
 * Security: requireOwner() on every action.
 */

"use server";

import { revalidatePath } from "next/cache";
import { requireOwner }   from "@/providers/owner-guard";
import { db }             from "@/db";
import { businessCosts, COST_CATEGORIES } from "@/db/schema/business-costs";
import { eq }             from "drizzle-orm";

/** addBusinessCostAction — Form fields: label, category, monthlyUsd, notes. */
export async function addBusinessCostAction(formData: FormData): Promise<void> {
  await requireOwner();

  const label      = String(formData.get("label") ?? "").trim();
  const categoryIn = String(formData.get("category") ?? "infrastructure");
  const notes      = String(formData.get("notes") ?? "").trim() || null;
  const monthlyUsd = Number(formData.get("monthlyUsd"));

  if (!label) throw new Error("Label required");
  if (!Number.isFinite(monthlyUsd) || monthlyUsd < 0 || monthlyUsd > 100_000) {
    throw new Error("Monthly amount must be a number between 0 and 100000");
  }
  const category = (COST_CATEGORIES as readonly string[]).includes(categoryIn)
    ? categoryIn
    : "other";

  await db.insert(businessCosts).values({
    label,
    category,
    monthlyUsd: monthlyUsd.toFixed(2),
    notes,
  });

  console.log(JSON.stringify({ event: "business_cost.added", label, monthlyUsd }));
  revalidatePath("/admin/cogs");
}

/** removeBusinessCostAction — Soft-delete (active = false). Field: costId. */
export async function removeBusinessCostAction(formData: FormData): Promise<void> {
  await requireOwner();

  const costId = String(formData.get("costId") ?? "");
  if (!costId) throw new Error("costId required");

  await db
    .update(businessCosts)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(businessCosts.id, costId));

  console.log(JSON.stringify({ event: "business_cost.removed", costId }));
  revalidatePath("/admin/cogs");
}
