/**
 * lib/cross-promo.ts — "More from the maker" links (single source of truth)
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (dashboard shell — nav, help, cross-promotion)
 *
 * Shown in the dashboard footer and on /help. Edit this list to change
 * cross-promotion everywhere at once.
 */

export interface PromoLink {
  label: string;
  href: string;
  description: string;
}

export const CROSS_PROMO_LINKS: PromoLink[] = [
  {
    label:       "Russell Nomer Consulting",
    href:        "https://www.russellnomer.com",
    description: "Cybersecurity & strategic risk advisory",
  },
  {
    label:       "CyberMRI",
    href:        "https://cybermri.io",
    description: "Pragmatic cyber hygiene methodology",
  },
  {
    label:       "The Grove — the book",
    href:        "https://a.co/d/01FaJZZ9",
    description: "The story behind our demo episode",
  },
];
