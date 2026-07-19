/**
 * app/dashboard/welcome/page.tsx — Founding Member welcome experience
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — Founding Member experience)
 *
 * Route: /dashboard/welcome
 *
 * Shown immediately after a user upgrades or accepts their beta invite.
 * Celebrates the milestone, explains what they get, and routes them to
 * key features (Discord, upload first episode, billing portal).
 *
 * Configurable env vars (optional — falls back gracefully):
 *   FOUNDING_MEMBER_DISCORD_URL  — Discord server invite URL
 *   FOUNDING_MEMBER_BADGE_LABEL  — Badge label (default: "Founding Member")
 */

import Link               from "next/link";
import { redirect }       from "next/navigation";
import { getAuthUser }    from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import {
  Mic2, Sparkles, MessageCircle, Star,
  ArrowRight, Gift, CheckCircle2,
} from "lucide-react";

// ─── Founding member perks ────────────────────────────────────────────────────

const PERKS = [
  { icon: Sparkles,    text: "Full AI content suite per episode — transcript, show notes, blog post, social copy, guest pack, PDF" },
  { icon: Star,        text: "Founding Member badge on your account — locked in forever" },
  { icon: Gift,        text: "Locked-in pricing — your rate never increases, even as we add features" },
  { icon: MessageCircle, text: "Direct access to the team — your feedback shapes the product roadmap" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WelcomePage() {
  const session = await getAuthUser();
  let plan: string | null = null;
  try {
    const identity = await requireOwnerFromSession(session);
    plan = identity.plan ?? null;
  } catch {
    redirect("/auth/login");
  }

  const discordUrl    = process.env.FOUNDING_MEMBER_DISCORD_URL  ?? null;
  const badgeLabel    = process.env.FOUNDING_MEMBER_BADGE_LABEL  ?? "Founding Member";
  const isAgency      = plan === "agency";
  const displayBadge  = plan === "pro" || isAgency ? badgeLabel : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-950 via-indigo-900 to-gray-950 flex items-center justify-center px-6 py-16">
      <div className="max-w-2xl w-full space-y-8">

        {/* Hero */}
        <div className="text-center">
          <div className="w-20 h-20 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-900 flex items-center justify-center mx-auto mb-6">
            <Mic2 className="w-10 h-10 text-white" />
          </div>

          {displayBadge && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 border border-amber-400/30 px-4 py-1 text-xs font-semibold text-amber-300 mb-4">
              <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
              {displayBadge}
            </span>
          )}

          <h1 className="text-4xl font-bold text-white leading-tight mt-2">
            You're in.
          </h1>
          <p className="text-indigo-300 text-lg mt-3">
            Welcome to PodLever{isAgency ? " Agency" : " Pro"}. Let's make your next episode your best one yet.
          </p>
        </div>

        {/* Perks card */}
        <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur px-8 py-7 space-y-5">
          <h2 className="text-sm font-semibold text-indigo-300 uppercase tracking-widest">What you unlock</h2>
          <ul className="space-y-4">
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                <span className="text-sm text-gray-200 leading-relaxed">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {/* Primary CTA */}
          <Link
            href="/dashboard/episodes/upload"
            className="flex items-center justify-between w-full rounded-xl bg-indigo-600 hover:bg-indigo-500
                       transition-colors px-6 py-4 text-white font-semibold"
          >
            <div className="flex items-center gap-3">
              <Mic2 className="w-5 h-5 text-indigo-200" />
              <div className="text-left">
                <p className="text-sm font-bold">Upload your first episode</p>
                <p className="text-xs text-indigo-300">Get your full content suite in minutes</p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-indigo-300" />
          </Link>

          {/* Discord */}
          {discordUrl ? (
            <a
              href={discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between w-full rounded-xl bg-white/5 border border-white/10
                         hover:bg-white/10 transition-colors px-6 py-4 text-white"
            >
              <div className="flex items-center gap-3">
                <MessageCircle className="w-5 h-5 text-indigo-300" />
                <div className="text-left">
                  <p className="text-sm font-semibold">Join the community</p>
                  <p className="text-xs text-gray-400">Shape the product roadmap alongside the team</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-500" />
            </a>
          ) : (
            <div className="flex items-center justify-between w-full rounded-xl bg-white/5 border border-white/10 px-6 py-4 opacity-50 cursor-default">
              <div className="flex items-center gap-3">
                <MessageCircle className="w-5 h-5 text-indigo-300" />
                <div className="text-left">
                  <p className="text-sm font-semibold text-white">Community access</p>
                  <p className="text-xs text-gray-400">Discord invite coming soon — we'll email you.</p>
                </div>
              </div>
            </div>
          )}

          {/* Skip */}
          <Link
            href="/dashboard/episodes"
            className="block text-center text-sm text-gray-500 hover:text-gray-300 transition-colors py-2"
          >
            Go to my episodes →
          </Link>
        </div>

        {/* Fine print */}
        <p className="text-center text-xs text-gray-600">
          Questions? Reply to your welcome email or{" "}
          <a href="mailto:support@podlever.com" className="text-indigo-500 hover:underline">
            contact us
          </a>
          .
        </p>
      </div>
    </div>
  );
}
