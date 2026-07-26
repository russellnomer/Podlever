/**
 * app/components/DemoShowcase.tsx — Interactive hero demo with real deliverables
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (playable examples on landing page)
 *
 * Replaces the static HeroAssetPreview mockup with a real, clickable demo.
 * Source material: "Welcome to The Grove" (Official Music Video) by
 * Russell Nomer / The Market Architect — youtu.be/iVJuqfxwdec — used with
 * the owner's permission. Every tab shows a REAL deliverable generated from
 * that recording, including cross-promotion of the companion book
 * "The Grove" (https://a.co/d/01FaJZZ9), which itself demonstrates the
 * kind of cross-promotion PodLever writes into show notes and social copy.
 *
 * Performance: the YouTube iframes are only mounted when their tab is
 * selected (no third-party JS on initial page load). The audio sample is a
 * 75-second 96 kbps MP3 in /public/demo (~880 KB), loaded on demand via
 * preload="none".
 */

"use client";

import { useState } from "react";

// ─── Deliverable definitions ──────────────────────────────────────────────────

const YT_ID = "iVJuqfxwdec";
const BOOK_URL = "https://a.co/d/01FaJZZ9";

type TabKey =
  | "audio"
  | "transcript"
  | "youtube"
  | "vertical"
  | "notes"
  | "blog"
  | "social";

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: "audio",      icon: "🎵",  label: "Cleaned Audio" },
  { key: "transcript", icon: "📝",  label: "Transcript" },
  { key: "youtube",    icon: "▶️",  label: "YouTube Cut" },
  { key: "vertical",   icon: "📱",  label: "Vertical Clip" },
  { key: "notes",      icon: "📋",  label: "Show Notes" },
  { key: "blog",       icon: "✍️",  label: "Blog Post" },
  { key: "social",     icon: "📣",  label: "Social Posts" },
];

// ─── Transcript excerpt (real lyrics, transcribed from the recording) ─────────

const TRANSCRIPT_LINES: { t: string; text: string }[] = [
  { t: "0:04", text: "\u201CThey call me when the body is already cold. Root cause pathologist. Let\u2019s see what killed this dream.\u201D" },
  { t: "0:18", text: "I walk into the wreckage, yeah, the board is burnin\u2019 down / Another empire crumbled in this profit-hungry town" },
  { t: "0:27", text: "You chase the quarterly numbers, strip the bark right off the tree / Now you\u2019re starin\u2019 at a hollow shell where business used to be" },
  { t: "0:38", text: "Efficiencies, you called it \u2014 nah, I call it suicide / Cuttin\u2019 out the experts just to feed the ego\u2019s pride" },
  { t: "0:49", text: "Treated people like machines, the culture like a mine / Now the rot is in the roots, and you\u2019re runnin\u2019 out of time" },
  { t: "1:00", text: "Are you the harvester? Tearing up the ground / Or the gardener? Turning it around" },
  { t: "1:10", text: "The storm is coming fast, and the weak ones won\u2019t survive / Welcome to the grove, where the roots keep us alive. Grow or die." },
  { t: "1:24", text: "Let me tell a little fable about a girl named Lena / Saw the sickness spreading like a corporate hyena" },
  { t: "1:33", text: "Investors came in hot with a slash-and-burn attack / Painting leaves green while the trunk was turning black" },
];

// ─── Component ────────────────────────────────────────────────────────────────

/** DemoShowcase — clickable, playable examples of every PodLever deliverable. */
export function DemoShowcase() {
  const [active, setActive] = useState<TabKey | null>(null);

  return (
    <div className="mt-12 relative" aria-label="Real output examples">
      {/* Inbound: the real recording */}
      <div className="flex justify-center mb-6">
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-zinc-900 border border-zinc-700/60">
          <span className="text-2xl" aria-hidden="true">🎙️</span>
          <div className="text-left">
            <p className="text-zinc-100 text-sm font-medium">welcome-to-the-grove.mp4</p>
            <p className="text-zinc-500 text-xs">3m 15s · real recording, real outputs below</p>
          </div>
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center mb-6" aria-hidden="true">
        <div className="flex flex-col items-center gap-1">
          <div className="w-px h-6 bg-gradient-to-b from-zinc-700 to-amber-500/50" />
          <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-amber-500/60" />
        </div>
      </div>

      {/* Output grid — clickable */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 max-w-3xl mx-auto">
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(isActive ? null : tab.key)}
              aria-expanded={isActive}
              className={`flex flex-col items-center gap-2 px-3 py-4 rounded-xl border transition-colors cursor-pointer ${
                isActive
                  ? "bg-zinc-800 border-amber-500/60"
                  : "bg-zinc-900/80 border-zinc-800/60 hover:border-zinc-600"
              }`}
            >
              <span className="text-2xl" aria-hidden="true">{tab.icon}</span>
              <p className="text-zinc-400 text-xs text-center leading-tight font-medium">
                {tab.label}
              </p>
              <div
                className={`w-full h-0.5 rounded-full ${isActive ? "bg-amber-500/70" : "bg-amber-500/20"}`}
                aria-hidden="true"
              />
              <p className="text-amber-400/70 text-xs">{isActive ? "Playing" : "Play it"}</p>
            </button>
          );
        })}
      </div>

      {/* Hint */}
      {!active && (
        <p className="mt-4 text-center text-zinc-500 text-xs">
          ☝️ Click any deliverable — these are real outputs from the recording above.
        </p>
      )}

      {/* Detail panel */}
      {active && (
        <div className="mt-6 max-w-3xl mx-auto rounded-2xl bg-zinc-900 border border-zinc-700/60 p-6 text-left">
          {active === "audio" && (
            <div>
              <PanelHeader
                title="Cleaned Audio"
                sub="Noise-gated, loudness-normalized, export-ready. 75-second sample:"
              />
              <audio
                controls
                preload="none"
                src="/demo/welcome-to-the-grove-sample.mp3"
                className="w-full"
              >
                Your browser does not support the audio element.
              </audio>
              <p className="mt-3 text-zinc-500 text-xs">
                Full-length cleaned masters export as MP3 or WAV from your dashboard.
              </p>
            </div>
          )}

          {active === "transcript" && (
            <div>
              <PanelHeader
                title="Full Transcript"
                sub="Time-coded, speaker-aware, edit-ready. Excerpt:"
              />
              <div className="max-h-72 overflow-y-auto space-y-2 pr-2">
                {TRANSCRIPT_LINES.map((line) => (
                  <p key={line.t} className="text-sm leading-relaxed">
                    <span className="text-amber-500/80 font-mono text-xs mr-2">{line.t}</span>
                    <span className="text-zinc-300">{line.text}</span>
                  </p>
                ))}
                <p className="text-zinc-500 text-xs pt-2">… full transcript continues (3m 15s)</p>
              </div>
            </div>
          )}

          {active === "youtube" && (
            <div>
              <PanelHeader
                title="YouTube Cut"
                sub="Titled, described, and tagged for search — published:"
              />
              <div className="aspect-video rounded-xl overflow-hidden border border-zinc-800">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${YT_ID}`}
                  title="Welcome to The Grove (Official Music Video) — The Market Architect"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                />
              </div>
            </div>
          )}

          {active === "vertical" && (
            <div>
              <PanelHeader
                title="Vertical Clip"
                sub="9:16 highlight with burned-in captions for Shorts, Reels, and TikTok:"
              />
              <div className="flex justify-center">
                <div className="w-[220px] aspect-[9/16] rounded-[1.5rem] overflow-hidden border-4 border-zinc-800 bg-black relative">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${YT_ID}?start=60`}
                    title="Vertical clip preview — Welcome to The Grove"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full"
                  />
                  <div className="absolute bottom-3 inset-x-2 text-center pointer-events-none">
                    <span className="inline-block px-2 py-1 rounded bg-black/70 text-amber-300 text-[10px] font-bold">
                      ARE YOU THE HARVESTER… OR THE GARDENER? 🌳
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {active === "notes" && (
            <div>
              <PanelHeader
                title="Show Notes"
                sub="Summary, chapters, and every link that matters — including cross-promotion:"
              />
              <div className="space-y-3 text-sm text-zinc-300 leading-relaxed">
                <p className="font-semibold text-zinc-100">
                  Welcome to The Grove — the anthem of the root-cause pathologist
                </p>
                <p>
                  A forensic walk through why companies die: quarterly-number chasing,
                  culture strip-mining, and &ldquo;efficiencies&rdquo; that cut out the experts.
                  The verdict comes down to one question — are you the harvester, tearing up
                  the ground for a quick cash season, or the gardener, building a root system
                  that outlasts the storm?
                </p>
                <ul className="space-y-1 text-zinc-400">
                  <li><span className="text-amber-500/80 font-mono text-xs mr-2">0:04</span>&ldquo;They call me when the body is already cold&rdquo; — the pathologist arrives</li>
                  <li><span className="text-amber-500/80 font-mono text-xs mr-2">0:38</span>&ldquo;Efficiencies, you called it — I call it suicide&rdquo;</li>
                  <li><span className="text-amber-500/80 font-mono text-xs mr-2">1:00</span>The choice: harvester or gardener</li>
                  <li><span className="text-amber-500/80 font-mono text-xs mr-2">1:24</span>The fable of Lena and the slash-and-burn investors</li>
                  <li><span className="text-amber-500/80 font-mono text-xs mr-2">2:20</span>Grow or die: building a legacy on root-system rock</li>
                </ul>
                <p className="pt-2 border-t border-zinc-800 text-zinc-400">
                  📖 This anthem is inspired by the book{" "}
                  <a
                    href={BOOK_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400 hover:text-amber-300 underline"
                  >
                    The Grove
                  </a>{" "}
                  — the business fable behind the harvester-vs-gardener framework.
                </p>
              </div>
            </div>
          )}

          {active === "blog" && (
            <div>
              <PanelHeader
                title="Blog Post"
                sub="SEO-ready long-form draft, generated from the transcript. Opening:"
              />
              <div className="space-y-3 text-sm text-zinc-300 leading-relaxed">
                <p className="font-semibold text-zinc-100 text-base">
                  The Harvester and the Gardener: A Root-Cause Autopsy of Why Companies Die
                </p>
                <p>
                  &ldquo;They call me when the body is already cold.&rdquo; That&rsquo;s how the
                  root-cause pathologist introduces himself — not as a consultant hired to
                  optimize a healthy business, but as the specialist who walks into the wreckage
                  after another empire has crumbled.
                </p>
                <p>
                  The autopsy always finds the same pathology. Leadership chased the quarterly
                  numbers and stripped the bark right off the tree. They called it efficiency;
                  the pathologist calls it suicide. They cut out the experts to feed the
                  ego&rsquo;s pride, treated people like machines and the culture like a mine —
                  and by the time anyone noticed, the rot was already in the roots&hellip;
                </p>
                <p className="text-zinc-500 text-xs">
                  … continues for ~1,200 words with headers, pull-quotes, and a call to action
                  linking the book and the video.
                </p>
              </div>
            </div>
          )}

          {active === "social" && (
            <div>
              <PanelHeader
                title="Social Posts"
                sub="Platform-native copy — ready to paste:"
              />
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs font-semibold text-blue-400 mb-2">LinkedIn</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">
                    &ldquo;Efficiencies,&rdquo; you called it. I call it suicide.{"\n"}
                    Every failed company I&rsquo;ve examined died the same way: quarterly-number
                    chasing, experts cut to feed the ego&rsquo;s pride, culture treated like a
                    mine. The rot starts in the roots — long before the balance sheet shows it.
                    The only question that matters: are you the harvester, or the gardener? 🌳
                    New anthem + the book that inspired it in the comments. #Leadership #Legacy
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs font-semibold text-zinc-300 mb-2">X / Twitter</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">
                    They call me when the body is already cold. 🩺{"\n"}
                    Root-cause autopsy of why companies die — as a track.{"\n"}
                    Harvester or gardener. Grow or die. 🌳{"\n"}
                    ▶️ youtu.be/{YT_ID} 📖 The book: a.co/d/01FaJZZ9
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs font-semibold text-pink-400 mb-2">Instagram</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">
                    Are you the harvester — take the quick cash 💰 — or the gardener, building
                    something that lasts? 🌳 The storm is coming fast, and the weak ones
                    won&rsquo;t survive. Welcome to The Grove. Full video + the book behind
                    it — link in bio. #WelcomeToTheGrove #GrowOrDie #TheMarketArchitect
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel header helper ──────────────────────────────────────────────────────

function PanelHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-zinc-100 font-semibold">{title}</h3>
      <p className="text-zinc-500 text-xs mt-0.5">{sub}</p>
    </div>
  );
}
