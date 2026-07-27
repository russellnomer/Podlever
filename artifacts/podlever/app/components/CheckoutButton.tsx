/**
 * app/components/CheckoutButton.tsx — Stripe Checkout CTA button
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #58 — pricing page Stripe Checkout)
 *
 * Client Component. Renders a "Get Pro" / "Get Agency" button that:
 *   1. Reads the billing period (annual/monthly) from localStorage —
 *      the same key used by PricingToggle so the price always matches
 *      what the user sees on screen.
 *   2. POSTs to /rpc/billing/checkout with the matching Stripe price ID.
 *   3. Redirects the browser to the Stripe Checkout URL on success.
 *   4. Redirects to /auth/login?next=... if the user is not logged in (401).
 *   5. Shows an inline error message on any other failure.
 *
 * Props:
 *   tier          — "pro" | "agency" (used for the login redirect ?next= param)
 *   annualPriceId — Stripe price ID for annual billing (e.g. "price_xxx")
 *   monthlyPriceId— Stripe price ID for monthly billing
 *   label         — Button label (default: "Get <tier>")
 *   variant       — "primary" | "outline"
 *   highlight     — Whether this is the highlighted/featured card
 */

"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "podlever_billing_period";

interface CheckoutButtonProps {
  tier:            "pro" | "agency";
  annualPriceId:   string;
  monthlyPriceId:  string;
  label?:          string;
  variant:         "primary" | "outline";
  highlight?:      boolean;
}

/**
 * CheckoutButton — Stripe Checkout redirect button.
 *
 * Aware of the billing period toggle so it always picks the right price ID
 * without any prop-drilling from the PricingToggle parent.
 */
export function CheckoutButton({
  tier,
  annualPriceId,
  monthlyPriceId,
  label,
  variant,
  highlight = false,
}: CheckoutButtonProps) {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [mounted, setMounted]   = useState(false);

  // Track mounted state to avoid hydration mismatch (localStorage only available client-side)
  useEffect(() => { setMounted(true); }, []);

  const buttonLabel = label ?? `Get ${tier.charAt(0).toUpperCase() + tier.slice(1)}`;

  async function handleClick() {
    setLoading(true);
    setError(null);

    // Read billing period from localStorage (set by PricingToggle)
    const period   = typeof window !== "undefined"
      ? (localStorage.getItem(STORAGE_KEY) ?? "annual")
      : "annual";
    const priceId  = period === "monthly" ? monthlyPriceId : annualPriceId;

    try {
      const resp = await fetch("/rpc/billing/checkout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ priceId }),
      });

      if (resp.status === 401) {
        // Not logged in — send to login then back to pricing with upgrade + billing params.
        // Include the resolved billing period so the post-login ?upgrade= auto-redirect
        // creates the correct Stripe Checkout session (annual vs monthly).
        const next = encodeURIComponent(`/pricing?upgrade=${tier}&billing=${period}`);
        window.location.href = `/auth/login?next=${next}`;
        return;
      }

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Request failed (${resp.status})`);
      }

      const data = await resp.json() as { url?: string };
      if (!data.url) throw new Error("No checkout URL returned");

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err) {
      console.error("Checkout error:", err);
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  // Render a placeholder during SSR to avoid hydration mismatch
  if (!mounted) {
    return (
      <div
        className={[
          "block w-full py-3 px-5 rounded-xl text-sm font-semibold text-center",
          "animate-pulse",
          variant === "primary"
            ? "bg-amber-400/50"
            : "border border-zinc-700 bg-zinc-800/50",
        ].join(" ")}
        aria-hidden="true"
      >
        &nbsp;
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={[
          "block w-full py-3 px-5 rounded-xl text-sm font-semibold text-center transition-all",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          variant === "primary"
            ? "bg-amber-400 hover:bg-amber-300 text-zinc-950"
            : "border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white",
          loading ? "opacity-60 cursor-wait" : "",
        ].join(" ")}
        aria-busy={loading}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="w-4 h-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Redirecting…
          </span>
        ) : (
          buttonLabel
        )}
      </button>

      {error && (
        <p className="text-xs text-red-400 text-center" role="alert">
          {error}
        </p>
      )}

      {/* Reassurance copy */}
      {!error && (
        <p className={[
          "text-xs text-center",
          highlight ? "text-zinc-500" : "text-zinc-600",
        ].join(" ")}>
          Secure checkout via Stripe · Cancel anytime
        </p>
      )}
    </div>
  );
}
