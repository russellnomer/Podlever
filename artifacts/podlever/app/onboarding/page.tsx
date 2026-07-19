/**
 * app/onboarding/page.tsx — First-run welcome page for beta users
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #55 — Beta invite & onboarding)
 *
 * Route: /onboarding
 *
 * Shown once to beta users after they claim their invite. On first visit,
 * the server action activateBetaUserAction() transitions their waitlist entry
 * from "invited" → "active" and updates their session cookie so they get full
 * product access on next navigation.
 *
 * Design: product explainer + single CTA ("Upload your first episode")
 */

import { redirect }              from "next/navigation";
import Link                      from "next/link";
import { getAuthUser }           from "@/providers/auth";
import { activateBetaUserAction } from "@/app/actions/beta.actions";
import { Zap, Mic, FileText, Share2, Gift } from "lucide-react";

// ─── Feature cards ────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: Mic,      label: "Upload audio",      desc: "MP3, M4A, WAV, OGG or FLAC — up to 25 MB per episode." },
  { icon: FileText, label: "AI transcript",     desc: "Full verbatim transcript via OpenAI Whisper in minutes." },
  { icon: FileText, label: "Show notes + blog", desc: "Structured markdown show notes and a 600-900 word blog post." },
  { icon: Share2,   label: "Social copy",       desc: "LinkedIn, Twitter, and Instagram captions — ready to paste." },
  { icon: Gift,     label: "Guest media pack",  desc: "Guest bio, key topics, and their shareable social announcement." },
];

export default async function OnboardingPage() {
  // Activate the beta user if they are in "invited" state.
  // This runs as a Server Action call that transitions invited → active
  // and updates their session cookie.
  const session = await getAuthUser();
  if (!session?.userId) redirect("/auth/login");

  // If already active, skip onboarding and go straight to the product
  if (session.betaAccess === "active" && session.role !== "owner") {
    redirect("/dashboard/episodes");
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
      {/* Hero */}
      <div className="max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-4 py-1.5 text-sm font-medium text-indigo-700 mb-6">
          <Zap className="w-3.5 h-3.5" />
          You&#39;re in — welcome to PodLever beta
        </div>
        <h1 className="text-4xl font-extrabold text-gray-900 leading-tight mb-4">
          Turn every episode into<br />a full content suite
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-10">
          Upload raw audio → get a transcript, show notes, blog post, social copy,
          and guest media pack in minutes. No copy-paste. No editing.
        </p>
        <form action={activateBetaUserAction}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-3.5 text-base
                       font-semibold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700
                       transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <Mic className="w-5 h-5" />
            Upload my first episode
          </button>
        </form>
      </div>

      {/* Feature grid */}
      <div className="max-w-3xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center mb-3">
                <Icon className="w-5 h-5 text-indigo-500" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{label}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        {/* Skip link */}
        <p className="mt-8 text-center text-sm text-gray-400">
          Already know the drill?{" "}
          <Link href="/dashboard/episodes" className="text-indigo-600 hover:underline">
            Go straight to episodes →
          </Link>
        </p>
      </div>
    </div>
  );
}
