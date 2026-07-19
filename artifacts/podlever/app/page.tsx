/**
 * app/page.tsx — PodLever public landing page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — Landing page)
 *
 * Server Component. Renders the full public-facing marketing page.
 * Unauthenticated visitors see the landing page; authenticated owners
 * are shown a banner linking to their dashboard.
 *
 * Sections:
 *   1. Nav — logo + CTA
 *   2. Hero — headline + email capture
 *   3. Pain — the post-production problem
 *   4. Solution — what PodLever generates
 *   5. How it works — 3-step flow
 *   6. Social proof — placeholder (real numbers in Phase 1B)
 *   7. Pricing CTA — teaser + link to /pricing
 *   8. Footer — portfolio cross-links
 *
 * SEO: metadata is set in layout.tsx root + per-page via generateMetadata in
 * Next.js 15 (layout handles root title/description/OG; page handles canonical).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getAuthUser } from "@/providers/auth";
import { WaitlistForm } from "@/app/components/WaitlistForm";

// ─── Per-page SEO override ────────────────────────────────────────────────────

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * LandingPage — Public marketing page (Server Component).
 *
 * Checks auth state to optionally surface a dashboard shortcut for the owner.
 * All marketing sections are statically rendered for SEO.
 */
export default async function LandingPage() {
  // Check if owner is logged in — show dashboard link if so
  const user = await getAuthUser().catch(() => null);
  const isOwner = user?.role === "owner";

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-zinc-100">

      {/* ── Owner shortcut banner ─────────────────────────────────────────── */}
      {isOwner && (
        <div className="bg-amber-500/10 border-b border-amber-500/20">
          <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center justify-between text-xs">
            <span className="text-amber-400/80">
              You&apos;re viewing the public landing page as owner.
            </span>
            <Link
              href="/dashboard"
              className="text-amber-400 hover:text-amber-300 font-medium transition-colors"
            >
              Go to Dashboard →
            </Link>
          </div>
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <Nav isOwner={isOwner} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <HeroSection />

      {/* ── Pain section ─────────────────────────────────────────────────── */}
      <PainSection />

      {/* ── Output assets ────────────────────────────────────────────────── */}
      <OutputSection />

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <HowItWorksSection />

      {/* ── Social proof ─────────────────────────────────────────────────── */}
      <SocialProofSection />

      {/* ── Pricing CTA ──────────────────────────────────────────────────── */}
      <PricingCtaSection />

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <Footer />
    </div>
  );
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function Nav({ isOwner }: { isOwner: boolean }) {
  return (
    <nav
      className="sticky top-0 z-50 border-b border-zinc-800/60 bg-[#0D0D0F]/90 backdrop-blur-md"
      aria-label="Main navigation"
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="PodLever home">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
            <WaveformIcon />
          </div>
          <span className="font-bold text-white tracking-tight">PodLever</span>
        </Link>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-8">
          <Link
            href="#how-it-works"
            className="text-zinc-400 hover:text-white text-sm transition-colors"
          >
            How it works
          </Link>
          <Link
            href="/pricing"
            className="text-zinc-400 hover:text-white text-sm transition-colors"
          >
            Pricing
          </Link>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          {isOwner ? (
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 text-sm font-semibold transition-colors"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="hidden sm:block text-zinc-400 hover:text-white text-sm transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/pricing"
                className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 text-sm font-semibold transition-colors"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-24 pb-32 px-6" aria-labelledby="hero-headline">
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="w-[600px] h-[400px] rounded-full bg-amber-500/8 blur-[120px]" />
      </div>

      {/* Subtle grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative max-w-4xl mx-auto text-center space-y-8">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-amber-500/20 bg-amber-500/8 text-amber-400 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
          Early access open
        </div>

        {/* Headline */}
        <div className="space-y-4">
          <h1
            id="hero-headline"
            className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] text-white"
          >
            One recording.{" "}
            <span className="text-amber-400">A complete</span>
            <br />
            content library.
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-zinc-400 leading-relaxed">
            PodLever transforms your raw episode into transcript, show notes, blog post,
            social clips, and guest media pack — automatically. Stop losing hours to
            post-production.
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-4">
          <WaitlistForm
            source="landing_hero"
            variant="hero"
            placeholder="your@email.com"
            buttonLabel="Get Early Access"
          />
          <p className="text-zinc-600 text-xs">
            Free tier available. No credit card required.
          </p>
        </div>

        {/* Hero asset preview */}
        <HeroAssetPreview />
      </div>
    </section>
  );
}

/** Visual mockup of the 7 output assets — shows the product value without screenshots. */
function HeroAssetPreview() {
  const assets = [
    { icon: "🎵", label: "Cleaned Audio", color: "amber" },
    { icon: "📝", label: "Transcript", color: "zinc" },
    { icon: "▶️", label: "YouTube Cut", color: "red" },
    { icon: "📱", label: "Vertical Clip", color: "purple" },
    { icon: "📋", label: "Show Notes", color: "zinc" },
    { icon: "✍️", label: "Blog Post", color: "zinc" },
    { icon: "📣", label: "Social Posts", color: "blue" },
  ] as const;

  return (
    <div className="mt-12 relative" aria-label="Output assets preview" role="img">
      {/* Inbound: single recording */}
      <div className="flex justify-center mb-6">
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-zinc-900 border border-zinc-700/60">
          <span className="text-2xl" aria-hidden="true">🎙️</span>
          <div className="text-left">
            <p className="text-zinc-100 text-sm font-medium">episode-142.mp4</p>
            <p className="text-zinc-500 text-xs">1h 23m · 1.2 GB raw recording</p>
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

      {/* Output grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 max-w-3xl mx-auto">
        {assets.map((asset) => (
          <div
            key={asset.label}
            className="flex flex-col items-center gap-2 px-3 py-4 rounded-xl bg-zinc-900/80 border border-zinc-800/60 hover:border-zinc-700 transition-colors"
          >
            <span className="text-2xl" aria-hidden="true">{asset.icon}</span>
            <p className="text-zinc-400 text-xs text-center leading-tight font-medium">
              {asset.label}
            </p>
            <div className="w-full h-0.5 rounded-full bg-amber-500/20" aria-hidden="true" />
            <p className="text-amber-400/70 text-xs">Ready</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pain section ─────────────────────────────────────────────────────────────

function PainSection() {
  const pains = [
    {
      icon: "⏱️",
      title: "3–4 hours per episode",
      body: "Editing, transcribing, writing show notes, cutting social clips, packaging for the guest. Every. Single. Episode.",
    },
    {
      icon: "🔁",
      title: "The same work, repeated",
      body: "Your process doesn't change episode to episode. You're doing the same manual tasks on autopilot while your best ideas sit unpublished.",
    },
    {
      icon: "📉",
      title: "Content that never ships",
      body: "That blog post you were going to write from episode 98. The LinkedIn carousel from episode 104. Still in your drafts.",
    },
    {
      icon: "💸",
      title: "Editors cost $500–2,000/episode",
      body: "Hiring help solves the time problem but creates a budget problem. Most independent podcasters eat the hours instead.",
    },
  ] as const;

  return (
    <section className="py-24 px-6 border-t border-zinc-800/40" aria-labelledby="pain-heading">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <p className="text-amber-400 text-sm font-semibold uppercase tracking-wider">
            The problem
          </p>
          <h2
            id="pain-heading"
            className="text-4xl sm:text-5xl font-bold tracking-tight text-white"
          >
            Post-production is eating your week
          </h2>
          <p className="max-w-2xl mx-auto text-zinc-400 text-lg leading-relaxed">
            You started a podcast to share ideas. Instead you spend most of your time
            on the work that happens <em className="not-italic text-zinc-300">after</em> the conversation ends.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pains.map((pain) => (
            <div
              key={pain.title}
              className="group p-6 rounded-2xl border border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60 transition-all"
            >
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-xl bg-zinc-800/80 border border-zinc-700/40 flex items-center justify-center text-xl"
                  aria-hidden="true"
                >
                  {pain.icon}
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-white font-semibold text-base">{pain.title}</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">{pain.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Output assets section ────────────────────────────────────────────────────

function OutputSection() {
  const outputs = [
    {
      icon: "🎵",
      title: "Cleaned Audio",
      description: "Noise-reduced, normalized, broadcast-ready. No more echo or background hiss.",
    },
    {
      icon: "📝",
      title: "Full Transcript",
      description: "Speaker-diarized, timestamped, searchable. JSON + plain text formats.",
    },
    {
      icon: "▶️",
      title: "YouTube Cut",
      description: "Full-length edited video with chapters, intro, and outro — ready to upload.",
    },
    {
      icon: "📱",
      title: "Vertical Clip",
      description: "Best 60 seconds reformatted for TikTok, Reels, and Shorts.",
    },
    {
      icon: "📋",
      title: "Show Notes",
      description: "Structured markdown with key takeaways, timestamps, and guest links.",
    },
    {
      icon: "✍️",
      title: "Blog Post",
      description: "Long-form article derived from your transcript. SEO-friendly, human-readable.",
    },
    {
      icon: "📣",
      title: "Social Posts",
      description: "Platform-native copy for LinkedIn, Twitter/X, and Instagram. Pull quotes, hooks, carousels.",
    },
    {
      icon: "🎁",
      title: "Guest Media Pack",
      description: "Professional asset bundle — clip, bio, quotes, promo graphics — ready to send.",
    },
  ] as const;

  return (
    <section className="py-24 px-6 bg-zinc-900/20" aria-labelledby="output-heading">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <p className="text-amber-400 text-sm font-semibold uppercase tracking-wider">
            What you get
          </p>
          <h2
            id="output-heading"
            className="text-4xl sm:text-5xl font-bold tracking-tight text-white"
          >
            Eight assets from one recording
          </h2>
          <p className="max-w-xl mx-auto text-zinc-400 text-lg leading-relaxed">
            Upload your raw file. PodLever generates your complete content suite —
            no editing software, no contractors, no waiting.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {outputs.map((output, i) => (
            <div
              key={output.title}
              className="relative p-5 rounded-2xl border border-zinc-800/60 bg-[#0D0D0F] hover:border-amber-500/20 hover:bg-zinc-900/40 transition-all group"
            >
              {/* Subtle amber corner accent on hover */}
              <div
                aria-hidden="true"
                className="absolute top-0 right-0 w-16 h-16 rounded-tr-2xl bg-gradient-to-bl from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
              />
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl" aria-hidden="true">{output.icon}</span>
                  <span className="text-xs font-mono text-zinc-600">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="text-white font-semibold">{output.title}</h3>
                <p className="text-zinc-500 text-sm leading-relaxed">{output.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How it works ──────────────────────────────────────────────────────────────

function HowItWorksSection() {
  const steps = [
    {
      step: "01",
      title: "Upload your recording",
      description:
        "Drop in your raw audio or video file — MP3, MP4, WAV, whatever you captured. No format conversion needed.",
      detail: "Supports files up to 4 hours",
    },
    {
      step: "02",
      title: "PodLever processes it",
      description:
        "Our pipeline cleans the audio, transcribes, identifies the best moments, and generates each asset in parallel.",
      detail: "Typically 10–25 minutes",
    },
    {
      step: "03",
      title: "Download your suite",
      description:
        "Review each asset, approve or request a revision, then export. Your content library is ready to publish.",
      detail: "One click per channel",
    },
  ] as const;

  return (
    <section
      id="how-it-works"
      className="py-24 px-6 border-t border-zinc-800/40"
      aria-labelledby="how-heading"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <p className="text-amber-400 text-sm font-semibold uppercase tracking-wider">
            The process
          </p>
          <h2
            id="how-heading"
            className="text-4xl sm:text-5xl font-bold tracking-tight text-white"
          >
            Three steps. Done.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connector line (decorative) */}
          <div
            aria-hidden="true"
            className="hidden md:block absolute top-12 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-px bg-gradient-to-r from-zinc-800 via-amber-500/30 to-zinc-800"
          />

          {steps.map((step) => (
            <div key={step.step} className="relative flex flex-col items-center text-center gap-5">
              {/* Step number circle */}
              <div className="relative z-10 w-24 h-24 rounded-full bg-[#0D0D0F] border-2 border-zinc-800 flex flex-col items-center justify-center gap-0.5 shadow-[0_0_40px_rgba(245,158,11,0.08)]">
                <span className="text-amber-400/60 text-xs font-mono">{step.step}</span>
                <div className="w-8 h-px bg-amber-500/30" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <h3 className="text-white font-semibold text-lg">{step.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed max-w-xs mx-auto">
                  {step.description}
                </p>
                <p className="text-amber-400/70 text-xs font-medium">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Social proof ──────────────────────────────────────────────────────────────

function SocialProofSection() {
  const stats = [
    { value: "8x", label: "more content from every episode" },
    { value: "~4h", label: "saved per episode" },
    { value: "10min", label: "average processing time" },
  ] as const;

  return (
    <section className="py-24 px-6 bg-zinc-900/20" aria-labelledby="proof-heading">
      <div className="max-w-6xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-zinc-800/40 rounded-2xl overflow-hidden border border-zinc-800/60">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-[#0D0D0F] px-8 py-10 text-center"
            >
              <p className="text-5xl font-bold text-amber-400 tracking-tight">{stat.value}</p>
              <p className="mt-2 text-zinc-400 text-sm">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Testimonial placeholder */}
        <div className="mt-12 text-center space-y-6">
          <h2
            id="proof-heading"
            className="text-2xl font-bold text-white"
          >
            Built for independent podcasters who ship
          </h2>
          <p className="max-w-2xl mx-auto text-zinc-400 leading-relaxed">
            PodLever is in active development. Early access spots are limited.
            Join the waitlist to be among the first to turn your recordings into
            a full content library — automatically.
          </p>
          <div className="flex justify-center">
            <WaitlistForm
              source="landing_proof"
              variant="hero"
              placeholder="your@email.com"
              buttonLabel="Join the Waitlist"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Pricing CTA ───────────────────────────────────────────────────────────────

function PricingCtaSection() {
  return (
    <section className="py-24 px-6 border-t border-zinc-800/40" aria-labelledby="pricing-cta-heading">
      <div className="max-w-3xl mx-auto text-center space-y-8">
        <div className="space-y-4">
          <p className="text-amber-400 text-sm font-semibold uppercase tracking-wider">Pricing</p>
          <h2
            id="pricing-cta-heading"
            className="text-4xl sm:text-5xl font-bold tracking-tight text-white"
          >
            Start free. Scale when you&apos;re ready.
          </h2>
          <p className="text-zinc-400 text-lg leading-relaxed">
            A free tier that delivers real value, Pro for serious podcasters,
            and Agency for production teams. No hidden fees.
          </p>
        </div>

        {/* Tier teasers */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          {[
            { name: "Free", price: "$0", tagline: "1 episode/mo" },
            { name: "Pro", price: "$29/mo", tagline: "10 episodes/mo", highlight: true },
            { name: "Agency", price: "$97/mo", tagline: "Unlimited" },
          ].map((tier) => (
            <div
              key={tier.name}
              className={[
                "px-4 py-5 rounded-xl border text-center",
                tier.highlight
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-zinc-900/40 border-zinc-800/60",
              ].join(" ")}
            >
              <p className={tier.highlight ? "text-amber-400 font-semibold" : "text-zinc-300 font-semibold"}>
                {tier.name}
              </p>
              <p className="text-white font-bold text-lg mt-1">{tier.price}</p>
              <p className="text-zinc-500 text-xs mt-0.5">{tier.tagline}</p>
            </div>
          ))}
        </div>

        <Link
          href="/pricing"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-base transition-colors"
        >
          See full pricing
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M2 8a.75.75 0 01.75-.75h8.69L8.22 4.03a.75.75 0 011.06-1.06l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 11-1.06-1.06l3.22-3.22H2.75A.75.75 0 012 8z" clipRule="evenodd" />
          </svg>
        </Link>
      </div>
    </section>
  );
}

// ─── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  const portfolio = [
    { label: "CreatorVidPro", href: "https://creatorvidpro.replit.app", title: "Screenplay analysis" },
    { label: "Coverage Council", href: "https://coveragecouncil.com", title: "Insurance coverage guidance" },
    { label: "RussellNomerMusic", href: "https://russellnomermusic.com", title: "Original music by Russell Nomer" },
    { label: "ResourcefulReporter", href: "https://resourcefulreporter.com", title: "Journalism resources" },
    { label: "PawsofKarma", href: "https://pawsofkarma.com", title: "Pet wellness" },
    { label: "GuildsForAll", href: "https://guildsforall.com", title: "Community guilds platform" },
    { label: "ThinkLikeACISO", href: "https://thinklikeaciso.com", title: "Cybersecurity leadership" },
    { label: "MarketArchitect", href: "https://marketarchitect.com", title: "Marketing strategy tools" },
    { label: "LotteryPro", href: "https://lotterypro.app", title: "Lottery analysis and tools" },
  ] as const;

  return (
    <footer className="border-t border-zinc-800/60 py-16 px-6" aria-label="Site footer">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <WaveformIcon />
              </div>
              <span className="font-bold text-white text-sm">PodLever</span>
            </div>
            <p className="text-zinc-500 text-sm leading-relaxed">
              One recording. A complete content library.
              Built by{" "}
              <a
                href="https://www.linkedin.com/in/russellnomer/"
                className="text-zinc-400 hover:text-white transition-colors underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Russell Nomer
              </a>
              .
            </p>
          </div>

          {/* Product */}
          <div className="space-y-4">
            <p className="text-zinc-300 text-sm font-semibold">Product</p>
            <ul className="space-y-2.5">
              {[
                { label: "How it works", href: "/#how-it-works" },
                { label: "Pricing", href: "/pricing" },
                { label: "Sign in", href: "/auth/login" },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Portfolio */}
          <div className="space-y-4">
            <p className="text-zinc-300 text-sm font-semibold">Also by Russell Nomer</p>
            <ul className="space-y-2.5">
              {portfolio.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.title}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-zinc-800/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-zinc-600 text-xs">
            © {new Date().getFullYear()} Russell Nomer Consulting. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            {/* Legal links — required before collecting email addresses publicly */}
            <Link
              href="/privacy"
              className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors"
            >
              Terms of Service
            </Link>
            <a
              href="https://www.linkedin.com/in/russellnomer/"
              className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              LinkedIn
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

/** Waveform icon — PodLever logo mark. */
function WaveformIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="text-amber-400"
    >
      <rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" />
      <rect x="4.5" y="3" width="2" height="10" rx="1" fill="currentColor" />
      <rect x="8" y="1" width="2" height="14" rx="1" fill="currentColor" />
      <rect x="11.5" y="4" width="2" height="8" rx="1" fill="currentColor" />
      <rect x="15" y="6" width="1" height="4" rx="0.5" fill="currentColor" />
    </svg>
  );
}
