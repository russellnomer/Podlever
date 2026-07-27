/**
 * app/terms/page.tsx — PodLever Terms of Service
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-27 by agent (Security sprint PR #22 — production expansion)
 *
 * Production terms: accounts, uploaded content & IP, prohibited content,
 * plans/billing/fair use, acceptable use, liability, NY governing law.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — PodLever",
  description:
    "PodLever Terms of Service — acceptable use, intellectual property, and limitation of liability.",
  alternates: { canonical: "/terms" },
};

/** Effective date — update this constant whenever material changes are made. */
const EFFECTIVE_DATE = "July 27, 2026";

export default function TermsPage() {
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
          <h1 className="text-4xl font-bold tracking-tight text-white">Terms of Service</h1>
          <p className="text-zinc-500 text-sm">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </header>

        <div className="space-y-10 text-zinc-300 text-[15px] leading-relaxed">

          {/* Intro */}
          <Section heading="Agreement">
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of
              PodLever, operated by Russell Nomer Consulting (&ldquo;we&rdquo;, &ldquo;us&rdquo;,
              or &ldquo;our&rdquo;). By submitting your email address to the PodLever waitlist or
              by using any part of the service, you agree to these Terms. If you do not agree, do
              not use the service.
            </p>
          </Section>

          {/* Service description */}
          <Section heading="The service">
            <p>
              PodLever turns podcast episodes into ready-to-publish content: you upload an audio
              or video recording, and we generate transcripts, show notes, social posts, cleaned
              audio, and related assets. Some capabilities may be offered in early access or
              marked as in development. Joining the waitlist does not create an account, guarantee
              access, or establish a commercial relationship.
            </p>
            <p className="mt-3">
              We reserve the right to modify, suspend, or discontinue the service at any time
              without notice or liability.
            </p>
          </Section>

          {/* Accounts */}
          <Section heading="Your account">
            <p>
              Sign-in is provided through Replit. You are responsible for maintaining the security
              of the account you sign in with (we strongly recommend enabling two-factor
              authentication on it) and for all activity that occurs under your account. Notify us
              immediately at hello@podlever.com if you believe your account has been compromised.
            </p>
          </Section>

          {/* Your content */}
          <Section heading="Your content">
            <p>
              <strong className="text-zinc-100">You own what you upload and what we generate
              from it.</strong> Transcripts, show notes, social posts, cleaned audio, and every
              other asset PodLever produces from your recordings belong to you. By uploading, you
              grant us a limited, non-exclusive licence to store and process your content solely
              to provide the service to you — nothing more. Your content is never used to train
              AI models.
            </p>
            <p className="mt-3">You represent that:</p>
            <ul className="mt-3 space-y-2 list-disc list-inside text-zinc-400">
              <li>
                You own the recordings you upload or have permission from the rights holders,
                including consent from guests and co-hosts where required by law.
              </li>
              <li>
                Your content does not infringe anyone&apos;s copyright, trademark, publicity, or
                privacy rights.
              </li>
              <li>
                Your content is not unlawful — including content that is defamatory, that
                sexually exploits minors, that incites violence, or that impersonates another
                person&apos;s voice without their consent.
              </li>
            </ul>
            <p className="mt-4">
              We may remove content and suspend accounts that violate these representations. You
              can delete your episodes or request deletion of your entire library at any time
              (see our <Link href="/privacy" className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors">Privacy Policy</Link>).
            </p>
            <p className="mt-3 text-zinc-500 text-sm">
              AI-generated output can contain errors. Review transcripts and generated assets
              before publishing — you are responsible for what you publish.
            </p>
          </Section>

          {/* Plans and billing */}
          <Section heading="Plans, billing, and fair use">
            <p>
              Paid plans are billed through Stripe on a recurring basis at the prices shown on
              our <Link href="/pricing" className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors">pricing page</Link>. You can cancel any time; your plan
              remains active until the end of the current billing period. Except where required
              by law, payments are non-refundable once a billing period has begun.
            </p>
            <p className="mt-3">
              Each plan includes a monthly episode allowance and a per-episode length limit.
              To keep the service fast and fairly priced for everyone, plans also carry a
              fair-use processing allowance:{" "}
              <strong className="text-zinc-100">Pro — 25 hours of source audio per month; Agency
              — 120 hours per month.</strong> If your usage consistently exceeds your plan&apos;s
              allowance, we will contact you about an appropriate plan before restricting
              anything.
            </p>
          </Section>

          {/* Acceptable use */}
          <Section heading="Acceptable use">
            <p>You agree not to:</p>
            <ul className="mt-3 space-y-2 list-disc list-inside text-zinc-400">
              <li>Submit false or misleading information to the waitlist form.</li>
              <li>
                Use automated tools, bots, or scripts to submit multiple waitlist entries or
                otherwise abuse the service.
              </li>
              <li>
                Attempt to gain unauthorised access to any part of the service or its underlying
                infrastructure.
              </li>
              <li>
                Use the service in any way that violates applicable local, national, or
                international law or regulation.
              </li>
              <li>
                Transmit any unsolicited commercial communications or harmful content through
                the service.
              </li>
              <li>
                Upload files that are not genuine audio or video recordings, or attempt to
                disguise other file types as media files.
              </li>
              <li>
                Deliberately circumvent plan limits, processing allowances, or rate limits —
                including by creating multiple accounts.
              </li>
              <li>
                Probe, scan, or test the vulnerability of the service other than through a
                good-faith report to hello@podlever.com.
              </li>
            </ul>
            <p className="mt-4">
              We may terminate or restrict access to anyone who violates these terms at our sole
              discretion.
            </p>
          </Section>

          {/* Intellectual property */}
          <Section heading="Intellectual property">
            <p>
              All content on the PodLever website — including text, graphics, code, and branding —
              is owned by Russell Nomer Consulting or its licensors. Nothing in these Terms grants
              you any right to use our trademarks, logos, or other proprietary materials.
            </p>
            <p className="mt-3">
              Ownership of the content you upload and the assets we generate from it is covered
              in the &ldquo;Your content&rdquo; section above — in short: it&apos;s yours.
            </p>
          </Section>

          {/* Disclaimer */}
          <Section heading="Disclaimer of warranties">
            <p>
              The service is provided <strong className="text-zinc-100">&ldquo;as is&rdquo;</strong>{" "}
              and{" "}
              <strong className="text-zinc-100">&ldquo;as available&rdquo;</strong> without
              warranty of any kind. We do not warrant that the service will be uninterrupted,
              error-free, or meet your requirements. The waitlist is provided as a convenience
              only, and we make no guarantee of launch dates, feature availability, or pricing.
            </p>
          </Section>

          {/* Limitation of liability */}
          <Section heading="Limitation of liability">
            <p>
              To the fullest extent permitted by applicable law, Russell Nomer Consulting and its
              owner shall not be liable for any indirect, incidental, special, consequential, or
              punitive damages arising out of or related to your use of, or inability to use, the
              service — even if we have been advised of the possibility of such damages.
            </p>
            <p className="mt-3">
              Our total liability to you for any claim arising under these Terms shall not exceed
              the amount you have paid us in the 12 months preceding the claim. If you have paid
              nothing (e.g. you are on a waitlist only), our liability is zero.
            </p>
          </Section>

          {/* Third-party links */}
          <Section heading="Third-party links">
            <p>
              The PodLever website may contain links to third-party websites. We are not
              responsible for the content, privacy practices, or terms of those sites. Links are
              provided for convenience and do not constitute an endorsement.
            </p>
          </Section>

          {/* Governing law */}
          <Section heading="Governing law">
            <p>
              These Terms are governed by the laws of the State of New York, United States,
              without regard to its conflict-of-law provisions. Any dispute arising under these
              Terms shall be resolved in the state or federal courts located in Nassau County or
              the Eastern District of New York, and you consent to their jurisdiction.
            </p>
          </Section>

          {/* Changes */}
          <Section heading="Changes to these Terms">
            <p>
              We may update these Terms from time to time. Material changes will be reflected in
              an updated effective date at the top of this page. Continued use of the service
              after changes take effect constitutes acceptance of the revised Terms.
            </p>
          </Section>

          {/* Contact */}
          <Section heading="Contact">
            <p>
              Questions about these Terms? Contact us at:{" "}
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
            <Link href="/privacy" className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">
              Privacy Policy
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
