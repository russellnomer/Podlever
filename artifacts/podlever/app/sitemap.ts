/**
 * app/sitemap.ts — Next.js dynamic sitemap generator
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — SEO)
 *
 * Generates sitemap.xml at /sitemap.xml at request time.
 * Lists all public-facing pages with their canonical URLs and update hints.
 *
 * HUMAN REVIEW NOTES:
 * - Private/auth routes (/auth/*, /dashboard) are intentionally excluded.
 * - Add new public pages here when they are created.
 * - `lastModified` uses the current date; consider tying it to content
 *   updates in Phase 1B when pages become dynamic.
 */

import type { MetadataRoute } from "next";

/**
 * SITE_URL — Same logic as layout.tsx; duplicated here to avoid
 * importing layout config (sitemap runs in the edge/node runtime at build time).
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://podlever.replit.app");

/**
 * sitemap — Returns all public pages for search engine indexing.
 *
 * Called by Next.js to generate /sitemap.xml automatically.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url:              `${SITE_URL}/`,
      lastModified:     now,
      changeFrequency:  "weekly",
      priority:         1.0,
    },
    {
      url:              `${SITE_URL}/pricing`,
      lastModified:     now,
      changeFrequency:  "monthly",
      priority:         0.9,
    },
    // Legal pages — added when waitlist email collection went public (Task #21)
    {
      url:              `${SITE_URL}/privacy`,
      lastModified:     now,
      changeFrequency:  "yearly",
      priority:         0.3,
    },
    {
      url:              `${SITE_URL}/terms`,
      lastModified:     now,
      changeFrequency:  "yearly",
      priority:         0.3,
    },
  ];
}
