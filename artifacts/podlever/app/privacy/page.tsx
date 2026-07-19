/**
 * app/privacy/page.tsx — PodLever Privacy Policy
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #21 — Legal compliance)
 *
 * Plain-language privacy policy required before collecting email addresses
 * from the public (GDPR Art. 13, CCPA § 1798.100).
 *
 * Covers: data collected, purpose, retention, deletion rights, contact.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — PodLever",
  description:
    "PodLever collects only your email address for waitlist notifications. Read our full privacy policy.",
  alternates: { canonical: "/privacy" },
};

/** Effective date — update this constant whenever material changes are made. */
const EFFECTIVE_DATE = "July 19, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0D0D0F] text-zinc-100">

      {/* ── Navigation ──────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-50 border-b border-zinc-800/60 bg-[#0D0D0F]/90 backdrop-blur-md"
        aria-label="Page navigation"
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group" aria-label="PodLever home">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
              <WaveformIcon />
            </div>
            <span className="font-bold text-white tracking-tight">PodLever</span>
          </Link>
          <Link
            href="/"
            className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </nav>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <main className="max-w-3xl mx-auto px-6 py-16 space-y-12" id="main-content">

        {/* Header */}
        <header className="space-y-3">
          <p className="text-amber-400 text-sm font-semibold uppercase tracking-wider">Legal</p>
          <h1 className="text-4xl font-bold tracking-tight text-white">Privacy Policy</h1>
          <p className="text-zinc-500 text-sm">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </header>

        <div className="prose-section space-y-10 text-zinc-300 text-[15px] leading-relaxed">

          {/* Intro */}
          <Section heading="Who we are">
            <p>
              PodLever is a podcast content automation tool operated by Russell Nomer Consulting
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;). This policy describes
              what personal data we collect, why we collect it, how long we keep it, and how you
              can request deletion.
            </p>
            <p className="mt-3">
              If you have any questions, contact us at{" "}
              <a
                href="mailto:hello@podlever.com"
                className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
              >
                hello@podlever.com
              </a>
              .
            </p>
          </Section>

          {/* Data collected */}
          <Section heading="What data we collect">
            <p>We collect only what we need:</p>
            <ul className="mt-3 space-y-2 list-none">
              <DataRow label="Email address" detail="When you join the early-access waitlist." />
              <DataRow
                label="Submission timestamp"
                detail="Recorded automatically when you submit the waitlist form."
              />
              <DataRow
                label="Source identifier"
                detail="Which page or button you used to join (e.g. landing page hero, pricing page). This is an internal label, not a tracking pixel or cookie."
              />
            </ul>
            <p className="mt-4 text-zinc-500 text-sm">
              We do <strong className="text-zinc-300">not</strong> collect your name, phone number,
              payment details, or any other personal information at this stage. We do not use
              third-party analytics cookies or fingerprinting on the waitlist form.
            </p>
          </Section>

          {/* Purpose */}
          <Section heading="Why we collect it">
            <p>
              Your email address is used for one purpose only: to notify you when PodLever opens
              early access or launches new features. We will not use it for unrelated marketing,
              sell it to third parties, or share it with advertisers.
            </p>
          </Section>

          {/* Legal basis */}
          <Section heading="Legal basis for processing (GDPR)">
            <p>
              If you are located in the European Economic Area or United Kingdom, we process your
              email address on the basis of <strong className="text-zinc-100">consent</strong>{" "}
              (GDPR Art. 6(1)(a)). You provide consent by submitting the waitlist form. You may
              withdraw consent at any time by requesting deletion (see below).
            </p>
          </Section>

          {/* Data storage */}
          <Section heading="How we store your data">
            <p>
              Waitlist submissions are stored in a Replit-managed PostgreSQL database hosted on
              infrastructure located in the United States. Data is encrypted at rest and in
              transit. Access is restricted to the application and the owner (Russell Nomer).
            </p>
          </Section>

          {/* Retention */}
          <Section heading="How long we keep it">
            <p>
              We retain waitlist email addresses until one of the following occurs:
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside text-zinc-400">
              <li>You request deletion (see below).</li>
              <li>PodLever launches and you create a full account (at which point the waitlist record is superseded).</li>
              <li>We determine that we will not launch — at which point all waitlist data will be deleted.</li>
            </ul>
          </Section>

          {/* Your rights */}
          <Section heading="Your rights">
            <p>Depending on where you live, you may have the right to:</p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside text-zinc-400">
              <li>Access the personal data we hold about you.</li>
              <li>Correct inaccurate data.</li>
              <li>Request deletion of your data (&ldquo;right to be forgotten&rdquo; under GDPR; &ldquo;right to delete&rdquo; under CCPA).</li>
              <li>Withdraw consent at any time without affecting prior processing.</li>
            </ul>
            <p className="mt-4">
              To exercise any of these rights, email{" "}
              <a
                href="mailto:hello@podlever.com"
                className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
              >
                hello@podlever.com
              </a>{" "}
              with the subject line &ldquo;Data request&rdquo; and include the email address you
              used to join the waitlist. We will respond within 30 days.
            </p>
          </Section>

          {/* Third parties */}
          <Section heading="Third-party services">
            <p>
              We do not sell or share your email address with third parties. The following
              infrastructure providers process data on our behalf:
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside text-zinc-400">
              <li>
                <strong className="text-zinc-300">Replit, Inc.</strong> — Hosts the application
                and database. See{" "}
                <a
                  href="https://replit.com/privacy"
                  className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Replit&apos;s Privacy Policy
                </a>
                .
              </li>
            </ul>
          </Section>

          {/* Changes */}
          <Section heading="Changes to this policy">
            <p>
              If we make material changes to this policy, we will update the effective date at the
              top of this page. For significant changes, we may also notify waitlist members by
              email before the changes take effect.
            </p>
          </Section>

          {/* Contact */}
          <Section heading="Contact">
            <p>
              Russell Nomer Consulting<br />
              Email:{" "}
              <a
                href="mailto:hello@podlever.com"
                className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
              >
                hello@podlever.com
              </a>
            </p>
          </Section>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800/60 py-8 px-6 mt-12" aria-label="Footer">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">
            ← Back to PodLever
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/terms" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">
              Terms of Service
            </Link>
            <p className="text-zinc-700 text-xs">
              © {new Date().getFullYear()} Russell Nomer Consulting
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Section wrapper with styled heading. */
function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-white border-b border-zinc-800/60 pb-2">
        {heading}
      </h2>
      <div>{children}</div>
    </section>
  );
}

/** Single data-type row in the "What we collect" list. */
function DataRow({ label, detail }: { label: string; detail: string }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-amber-400/60 mt-[7px]" aria-hidden="true" />
      <span>
        <strong className="text-zinc-100">{label}</strong>{" "}
        <span className="text-zinc-400">— {detail}</span>
      </span>
    </li>
  );
}

/** Waveform icon — PodLever logo mark. */
function WaveformIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-amber-400">
      <rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" />
      <rect x="4.5" y="3" width="2" height="10" rx="1" fill="currentColor" />
      <rect x="8" y="1" width="2" height="14" rx="1" fill="currentColor" />
      <rect x="11.5" y="4" width="2" height="8" rx="1" fill="currentColor" />
      <rect x="15" y="6" width="1" height="4" rx="0.5" fill="currentColor" />
    </svg>
  );
}
