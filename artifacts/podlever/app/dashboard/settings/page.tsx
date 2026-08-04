/**
 * app/dashboard/settings/page.tsx — Account settings
 *
 * Part of: PodLever
 * Created: 2026-08-04 by agent (Board directive — Sprint 1 🔴 persona system)
 *
 * Route: /dashboard/settings (authenticated beta/paid users)
 *
 * Current settings:
 *   - Audience persona — which archetype PodLever writes for
 *
 * Plan gating:
 *   Free/Beta: "General audience" only (premium options visible but locked)
 *   Pro/Agency: all 6 premium archetypes selectable
 *
 * SECURITY: requireBetaAccess() — unauthenticated users redirect to login.
 */

import { redirect }               from "next/navigation";
import Link                        from "next/link";
import { getAuthUser }             from "@/providers/auth";
import { requireBetaAccess }       from "@/providers/owner-guard";
import { db }                      from "@/db";
import { users }                   from "@/db/schema";
import { eq }                      from "drizzle-orm";
import { PERSONA_LIST }            from "@/lib/personas";
import { PersonaSelectorClient }   from "./components/PersonaSelectorClient";
import { Settings, Lock, Zap }     from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session  = await getAuthUser();
  let userId: string;
  let plan: string;

  try {
    const identity = await requireBetaAccess(session);
    userId = identity.userId;
    plan   = identity.plan ?? "free";
  } catch {
    redirect("/auth/login");
  }

  // Fetch current persona setting
  const [userRow] = await db
    .select({ audiencePersona: users.audiencePersona })
    .from(users)
    .where(eq(users.id, userId!))
    .limit(1);

  const currentPersona = userRow?.audiencePersona ?? "general";
  const isPaidPlan     = plan! === "pro" || plan! === "agency";

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Settings className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Account Settings</h1>
            <p className="text-sm text-gray-500">
              Configure how PodLever generates content for your show
            </p>
          </div>
        </div>

        {/* Audience Persona */}
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Audience Persona</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  PodLever tailors every piece of generated content — show notes, blog posts,
                  social copy — for the specific audience of your show. Set this once; it
                  applies to every episode automatically.
                </p>
              </div>
              {!isPaidPlan && (
                <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700">
                  <Lock className="w-3 h-3" />
                  Pro feature
                </span>
              )}
            </div>
          </div>

          <div className="px-6 py-5">
            {/* Current plan context */}
            {!isPaidPlan && (
              <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3.5 flex items-start gap-3">
                <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-900">
                    You&apos;re on the {plan === "beta" ? "Beta" : "Free"} plan
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Upgrade to Pro to unlock all 6 audience archetypes.
                    Free users receive &ldquo;General&rdquo; — professional, balanced writing
                    that works for any audience.
                  </p>
                  <Link
                    href="/dashboard/billing"
                    className="inline-block mt-2 text-xs font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2"
                  >
                    Upgrade to Pro →
                  </Link>
                </div>
              </div>
            )}

            {/* Persona selector — client component for optimistic UI */}
            <PersonaSelectorClient
              currentPersona={currentPersona}
              isPaidPlan={isPaidPlan}
              personas={PERSONA_LIST}
            />
          </div>
        </section>

        {/* Future settings placeholder */}
        <section className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-5 opacity-60">
          <h2 className="text-sm font-semibold text-gray-400">Brand Logo</h2>
          <p className="text-xs text-gray-400 mt-1">
            Upload your logo to co-brand generated PDFs — coming in Sprint 2.
          </p>
        </section>

      </div>
    </main>
  );
}
