/**
 * app/dashboard/episodes/new/page.tsx — New episode upload page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #2 — Episode processing pipeline)
 *
 * Route: /dashboard/episodes/new (owner-only)
 *
 * Server Component that enforces auth then renders the EpisodeUploadForm client
 * component. The form submits via uploadEpisodeAction, which handles storage,
 * FSM transition, and processing trigger before redirecting to the detail page.
 */

import { redirect }            from "next/navigation";
import Link                    from "next/link";
import { getAuthUser }         from "@/providers/auth";
import { requireBetaAccess }   from "@/providers/owner-guard";
import { usageRepository }         from "@/repositories";
import { trackServerEvent }        from "@/lib/analytics";
import { EpisodeUploadForm }       from "../components/EpisodeUploadForm";
import { ArrowLeft, Zap }          from "lucide-react";

export default async function NewEpisodePage() {
  // Auth guard — redirect unauthenticated users to login
  const session = await getAuthUser();
  let userId: string | undefined;
  try {
    // Allow owners and active beta users — episode creation is open to beta testers
    const identity = await requireBetaAccess(session);
    userId = identity.userId;
  } catch {
    redirect("/auth/login");
  }

  // Usage gate — check if the user is at their monthly episode limit
  const usage = await usageRepository.getUsageSummary(userId!);

  // Track upgrade_prompt_shown when a user hits their limit (non-blocking)
  if (usage.atLimit) {
    trackServerEvent("upgrade_prompt_shown", userId!, {
      plan: usage.plan, used: usage.used, limit: usage.limit,
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center gap-4">
          <Link
            href="/dashboard/episodes"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            All episodes
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-800">New episode</span>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Page heading */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Upload a new episode</h1>
          </div>
          <p className="text-sm text-gray-500 ml-12">
            PodLever will transcribe your audio and generate a full content suite:
            show notes, blog post, social copy, and a guest media pack.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <EpisodeUploadForm
            atLimit={usage.atLimit}
            planLabel={usage.tierLabel}
            used={usage.used}
            limit={usage.limit}
            isTrialOnly={usage.isTrialOnly}
          />
        </div>

        {/* Tip */}
        <p className="mt-4 text-center text-xs text-gray-400">
          Audio and video up to 300 MB. Long episodes are compressed and
          transcribed automatically. Typical processing time: 2–5 minutes.
        </p>
      </main>
    </div>
  );
}
