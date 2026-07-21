/**
 * app/dashboard/layout.tsx — Dashboard shell layout
 *
 * Part of: PodLever
 * Created: 2026-07-21 by agent
 *
 * Wraps all /dashboard/* routes with shared shell UI. Currently provides:
 *   - The persistent FeedbackWidget floating button (bottom-right corner)
 *     visible to all authenticated users on every dashboard page.
 *
 * Phase 1B+: extend with a top-level nav, notification bell, or user menu
 * without touching individual page files.
 *
 * This is a Server Component — the FeedbackWidget is client-only and is
 * imported as a leaf client component within the server tree.
 */

import { FeedbackWidget } from "./components/FeedbackWidget";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      {/*
       * FeedbackWidget — floating feedback button + modal.
       * Rendered outside the page scrolling context so it always stays in
       * the viewport corner regardless of page scroll position.
       */}
      <FeedbackWidget />
    </>
  );
}
