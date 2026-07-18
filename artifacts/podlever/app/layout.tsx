/**
 * app/layout.tsx — PodLever root layout
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T6 — AuthProvider resolved via iron-session)
 *
 * HUMAN REVIEW NOTES:
 * Auth in PodLever uses iron-session (encrypted HTTP-only cookies) — no client-side
 * AuthProvider React Context is needed. Auth state is read server-side via getAuthUser()
 * in each Server Component that needs it (e.g., app/page.tsx).
 *
 * If a client-side auth hook is ever needed (e.g., for a "Sign out" button in a
 * Client Component), create a thin /api/auth/user JSON endpoint + SWR hook.
 * Do not add a client-side session store for Phase 1A — there are no client mutations.
 *
 * Phase 1B: Add toast notification provider here when episode processing
 * produces async job completion events the UI needs to react to.
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title:       "PodLever — Podcast Content Engine",
  description: "One recording. Complete asset suite.",
};

/**
 * RootLayout — the root Next.js layout.
 *
 * No client-side providers needed in Phase 1A:
 * - Auth: iron-session reads from server-side cookies in each Server Component
 * - Theme: Tailwind CSS v4 handles theming via CSS custom properties
 * - State: No global client state in Phase 1A (single-owner, no optimistic updates)
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-zinc-950 text-zinc-100">
        {children}
      </body>
    </html>
  );
}
