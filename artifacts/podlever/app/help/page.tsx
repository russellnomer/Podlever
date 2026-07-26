/**
 * app/help/page.tsx — Help & FAQ
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (dashboard shell — nav, help, cross-promotion)
 *
 * Route: /help (public — linked from the dashboard nav and footer)
 *
 * Static server component. Update the FAQS array to change content; keep
 * answers in sync with lib/tiers.ts limits and the upload form constraints.
 */

import Link                  from "next/link";
import { Zap, ArrowLeft }    from "lucide-react";
import { CROSS_PROMO_LINKS } from "@/lib/cross-promo";

export const metadata = {
  title:       "Help & FAQ — PodLever",
  description: "Answers about uploads, processing, plans, and your PodLever account.",
};

interface Faq {
  q: string;
  a: string;
}

const FAQS: Faq[] = [
  {
    q: "What does PodLever actually do?",
    a: "You upload a podcast episode (audio or video). PodLever transcribes it and generates a complete, publish-ready content package: a full transcript, polished show notes, a blog post, social media posts, and a shareable guest media pack — in minutes, not hours.",
  },
  {
    q: "What file formats and sizes are supported?",
    a: "Audio: MP3, M4A, WAV, OGG, FLAC. Video: MP4, MOV, WEBM — we extract the audio track automatically. Files can be up to 300 MB; they upload directly to secure cloud storage, so large episodes work fine even on slower connections.",
  },
  {
    q: "How long does processing take?",
    a: "Typically 2–5 minutes for a normal-length episode. Very long recordings (2+ hours) are compressed and transcribed in segments and can take a little longer. You can leave the page — the episode keeps processing and shows up in your Episodes list when ready.",
  },
  {
    q: "How many episodes can I process?",
    a: "Free trial: 1 episode (lifetime) up to 60 minutes. Beta members: 10 episodes per month, up to 4-hour files, complimentary during the beta. Pro: 10 episodes/month. Agency: 50 episodes/month. Your current usage is always enforced at upload time.",
  },
  {
    q: "Can I edit the generated content?",
    a: "Yes — every asset (show notes, blog post, social posts, guest pack) is yours to copy, edit, and publish anywhere. You can also regenerate individual assets from the episode page if you want a different take.",
  },
  {
    q: "How do I invite someone / how did I get access?",
    a: "PodLever is in private beta. Access is by invitation — invitees claim their invite by signing in with a free Replit account and entering the email address that was invited.",
  },
  {
    q: "Is my audio private?",
    a: "Yes. Files are stored in a private cloud bucket that is not publicly accessible; download links are short-lived and signed. Transcription runs through the OpenAI API. We never publish or share your content.",
  },
  {
    q: "How do I log out?",
    a: "Use the Log out button in the top-right of the dashboard (or the link in the footer). Logging out invalidates your session everywhere, on every device.",
  },
  {
    q: "How does billing work?",
    a: "Paid plans (Pro, Agency) are billed through Stripe with monthly or annual pricing — see the Pricing page. Beta members pay nothing during the beta. You can cancel anytime; your plan stays active until the end of the paid period.",
  },
  {
    q: "Something looks wrong — how do I report it?",
    a: "Use the Feedback button in the bottom-right corner of any dashboard page. As a beta member your reports go straight to the founder and directly shape the product.",
  },
];

export default function HelpPage() {
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
            Back to app
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Help &amp; FAQ</h1>
          </div>
          <p className="text-sm text-gray-500 ml-12">
            Everything you need to know about uploading, processing, plans, and your account.
          </p>
        </div>

        {/* FAQ list */}
        <div className="space-y-4">
          {FAQS.map((faq) => (
            <details
              key={faq.q}
              className="group bg-white rounded-xl border border-gray-200 shadow-sm open:shadow-md transition-shadow"
            >
              <summary className="cursor-pointer select-none px-6 py-4 text-sm font-semibold text-gray-900 list-none flex items-center justify-between">
                {faq.q}
                <span className="ml-4 text-gray-400 group-open:rotate-45 transition-transform text-lg leading-none">+</span>
              </summary>
              <p className="px-6 pb-5 text-sm leading-relaxed text-gray-600">{faq.a}</p>
            </details>
          ))}
        </div>

        {/* Contact */}
        <div className="mt-10 rounded-2xl border border-indigo-100 bg-indigo-50 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Still stuck?</h2>
          <p className="text-sm text-gray-600">
            Use the <span className="font-medium">Feedback</span> button in the corner of any dashboard
            page — during the beta, every message is read by the founder.
          </p>
        </div>

        {/* Cross-promotion */}
        <div className="mt-10">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">More from the maker</p>
          <ul className="space-y-2 text-sm">
            {CROSS_PROMO_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  {link.label}
                </a>
                <span className="text-gray-400"> — {link.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
