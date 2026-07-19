/**
 * app/components/PricingToggle.tsx — Annual/monthly billing toggle
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — Pricing page)
 *
 * Client Component. Handles the interactive annual/monthly billing switch
 * on the pricing page. Updates price displays in the DOM without a full
 * page navigation (no server round-trip needed for a cosmetic change).
 *
 * Implementation:
 *   - Reads initial state from localStorage (persists last selection).
 *   - Updates all [data-tier] spans on toggle to show correct price.
 *   - Updates [data-billing-note] paragraphs to show billing period.
 *   - Falls back gracefully when JS is disabled (annual shown by default).
 *
 * HUMAN REVIEW NOTES:
 * The pricing data lives in pricing/page.tsx as data attributes on the
 * rendered price spans (data-annual, data-monthly). This avoids prop-drilling
 * a toggle state up to the Server Component tree.
 */

"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "podlever_billing_period";

type BillingPeriod = "annual" | "monthly";

/**
 * PricingToggle — Annual/Monthly billing switch.
 *
 * Updates price displays via DOM manipulation for instant feedback
 * without a server round-trip. Works alongside the server-rendered
 * pricing cards in app/pricing/page.tsx.
 */
export function PricingToggle() {
  const [period, setPeriod] = useState<BillingPeriod>("annual");
  const [mounted, setMounted] = useState(false);

  // Restore persisted preference after hydration
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "monthly" || saved === "annual") {
      setPeriod(saved);
      applyPrices(saved);
    }
    setMounted(true);
  }, []);

  /** Update all price displays in the DOM. */
  const applyPrices = useCallback((p: BillingPeriod) => {
    // Update price spans: <span data-tier="pro" data-annual="29" data-monthly="41">
    document.querySelectorAll<HTMLElement>("[data-tier][data-annual][data-monthly]").forEach((el) => {
      const price = p === "annual" ? el.dataset.annual : el.dataset.monthly;
      if (price !== undefined) el.textContent = `$${price}`;
    });

    // Update billing notes: <p data-billing-note="pro">
    document.querySelectorAll<HTMLElement>("[data-billing-note]").forEach((el) => {
      const tier = el.dataset.billingNote as "pro" | "agency";
      const annualPrices: Record<string, number> = { pro: 29, agency: 97 };
      const monthlyPrices: Record<string, number> = { pro: 41, agency: 136 };
      const annualYearly: Record<string, number> = { pro: 348, agency: 1164 };

      if (p === "annual") {
        el.textContent = `billed annually ($${annualYearly[tier]}/yr) · $${monthlyPrices[tier]}/mo billed monthly`;
      } else {
        el.textContent = `billed monthly · save $${(monthlyPrices[tier] - annualPrices[tier]) * 12}/yr with annual`;
      }
    });
  }, []);

  const toggle = useCallback(
    (next: BillingPeriod) => {
      setPeriod(next);
      localStorage.setItem(STORAGE_KEY, next);
      applyPrices(next);
    },
    [applyPrices],
  );

  // Don't render toggle controls until mounted (avoids hydration mismatch)
  if (!mounted) {
    return (
      <div className="h-10 w-64 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" aria-hidden="true" />
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-900 border border-zinc-800"
      role="group"
      aria-label="Billing period"
    >
      <button
        type="button"
        onClick={() => toggle("annual")}
        className={[
          "px-4 py-2 rounded-lg text-sm font-medium transition-all",
          period === "annual"
            ? "bg-amber-400 text-zinc-950 shadow-sm"
            : "text-zinc-400 hover:text-zinc-200",
        ].join(" ")}
        aria-pressed={period === "annual"}
      >
        Annual
        <span
          className={[
            "ml-2 text-xs font-semibold px-1.5 py-0.5 rounded-md",
            period === "annual"
              ? "bg-zinc-950/20 text-zinc-950"
              : "bg-amber-500/15 text-amber-400",
          ].join(" ")}
        >
          Save 29%
        </span>
      </button>
      <button
        type="button"
        onClick={() => toggle("monthly")}
        className={[
          "px-4 py-2 rounded-lg text-sm font-medium transition-all",
          period === "monthly"
            ? "bg-amber-400 text-zinc-950 shadow-sm"
            : "text-zinc-400 hover:text-zinc-200",
        ].join(" ")}
        aria-pressed={period === "monthly"}
      >
        Monthly
      </button>
    </div>
  );
}
