/**
 * app/components/WaitlistForm.tsx — Early-access waitlist capture form
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — Landing page)
 *
 * Client Component: uses useActionState for progressive-enhancement form.
 * Works without JavaScript (server action handles submission) and shows
 * inline success/error feedback when JS is enabled.
 *
 * HUMAN REVIEW NOTES:
 * - `source` hidden input tracks which CTA triggered the signup.
 * - Form is intentionally minimal — one field, one button. Less friction = more signups.
 */

"use client";

import { useActionState } from "react";
import { joinWaitlist, type WaitlistResult } from "@/app/actions/waitlist.actions";

interface WaitlistFormProps {
  /** Tracks which CTA / page section triggered this form. */
  source?: string;
  /** Visual variant — default inline, "hero" is larger */
  variant?: "default" | "hero";
  placeholder?: string;
  buttonLabel?: string;
}

/**
 * WaitlistForm — Email capture form that submits to the joinWaitlist Server Action.
 *
 * Uses React 19 useActionState for server-side validation feedback.
 * Renders inline (email input + button in one row) for compact placement.
 */
export function WaitlistForm({
  source = "landing",
  variant = "default",
  placeholder = "your@email.com",
  buttonLabel = "Get Early Access",
}: WaitlistFormProps) {
  const [state, formAction, isPending] = useActionState<WaitlistResult | null, FormData>(
    joinWaitlist,
    null,
  );

  // ── Success state ──────────────────────────────────────────────────────────
  if (state?.success) {
    return (
      <div
        className={
          variant === "hero"
            ? "flex items-center gap-3 px-5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 max-w-md"
            : "flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30"
        }
        role="status"
        aria-live="polite"
      >
        {/* Checkmark icon */}
        <svg
          className="flex-shrink-0 w-5 h-5 text-amber-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
        <p className={variant === "hero" ? "text-amber-300 text-sm font-medium" : "text-amber-300 text-xs font-medium"}>
          {state.message}
        </p>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  const isHero = variant === "hero";

  return (
    <form action={formAction} className="w-full max-w-md">
      {/* Hidden source tracker */}
      <input type="hidden" name="source" value={source} />

      <div className={`flex gap-2 ${isHero ? "flex-col sm:flex-row" : "flex-row"}`}>
        {/* Email input */}
        <label htmlFor={`waitlist-email-${source}`} className="sr-only">
          Email address
        </label>
        <input
          id={`waitlist-email-${source}`}
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder={placeholder}
          disabled={isPending}
          className={[
            "flex-1 bg-zinc-900 border text-zinc-100 placeholder-zinc-600",
            "focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50",
            "transition-colors disabled:opacity-50",
            state?.success === false
              ? "border-red-500/50"
              : "border-zinc-700/60 hover:border-zinc-600",
            isHero
              ? "rounded-xl px-4 py-3 text-sm"
              : "rounded-lg px-3 py-2 text-xs",
          ].join(" ")}
          aria-invalid={state?.success === false}
          aria-describedby={state?.success === false ? `waitlist-error-${source}` : undefined}
        />

        {/* Submit button */}
        <button
          type="submit"
          disabled={isPending}
          className={[
            "font-semibold text-zinc-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500",
            "transition-colors disabled:opacity-50 disabled:cursor-wait whitespace-nowrap",
            "focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-offset-2 focus:ring-offset-zinc-950",
            isHero
              ? "rounded-xl px-6 py-3 text-sm"
              : "rounded-lg px-4 py-2 text-xs",
          ].join(" ")}
        >
          {isPending ? "Joining…" : buttonLabel}
        </button>
      </div>

      {/* Error message */}
      {state?.success === false && (
        <p
          id={`waitlist-error-${source}`}
          className="mt-2 text-red-400 text-xs"
          role="alert"
          aria-live="assertive"
        >
          {state.error}
        </p>
      )}

      {/* Consent / legal note — required before collecting email addresses publicly */}
      <p className="mt-2 text-zinc-600 text-xs text-center leading-relaxed">
        By joining you agree to our{" "}
        <a
          href="/privacy"
          className="underline underline-offset-2 hover:text-zinc-400 transition-colors"
        >
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}
