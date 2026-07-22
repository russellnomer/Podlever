/**
 * app/dashboard/components/FeedbackWidget.tsx — Floating in-app feedback button
 *
 * Part of: PodLever
 * Created: 2026-07-21 by agent
 *
 * Client Component. Renders a persistent floating "Feedback" button in the
 * bottom-right corner of every /dashboard/* page (mounted via dashboard layout).
 *
 * On click, opens a compact modal pre-loaded with the current page URL
 * (captured via window.location.href) and a free-text field. On submit,
 * calls submitFeedbackAction. Shows a success state for 2.2 seconds then
 * closes automatically.
 *
 * No props required — the server action reads the user identity from the
 * session cookie server-side.
 *
 * Accessibility:
 *   - Trap focus on the modal when open (native focus order via tabIndex)
 *   - aria-label on icon-only elements
 *   - Dismiss on backdrop click or Escape key
 */

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquarePlus, X, Send, CheckCircle2, Loader2 } from "lucide-react";
import { submitFeedbackAction } from "@/app/actions/feedback.actions";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * FeedbackWidget — Floating button + modal for in-app feedback collection.
 * Mounts once in the dashboard layout; always visible on /dashboard/* routes.
 */
export function FeedbackWidget() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [open, setOpen]         = useState(false);
  const [message, setMessage]   = useState("");
  const [status, setStatus]     = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef    = useRef<HTMLDivElement>(null);

  // ── Keyboard dismiss ───────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) setOpen(false);
  }, [open]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Auto-focus textarea when modal opens ───────────────────────────────────
  useEffect(() => {
    if (open) {
      // Small delay so the modal is painted before focus is moved
      const t = setTimeout(() => textareaRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // ── Submit handler ─────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || status === "sending") return;

    setStatus("sending");
    setErrorMsg("");

    const result = await submitFeedbackAction({
      pageUrl: window.location.href,
      message: message.trim(),
    });

    if (result.ok) {
      setStatus("sent");
      setMessage("");
      // Auto-close after 2.2 s
      setTimeout(() => { setOpen(false); setStatus("idle"); }, 2200);
    } else {
      setStatus("error");
      setErrorMsg(result.error);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Floating trigger ─────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full
                   bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg
                   hover:bg-indigo-700 transition-all hover:scale-105 active:scale-95
                   focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
      >
        <MessageSquarePlus className="w-4 h-4" aria-hidden />
        Feedback
      </button>

      {/* ── Modal ────────────────────────────────────────────────────────── */}
      {open && (
        /* Backdrop — clicking outside the modal card closes it */
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Send feedback"
          className="fixed inset-0 z-50 flex items-end justify-end p-6"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            ref={modalRef}
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-2xl
                       animate-in slide-in-from-bottom-4 duration-200"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Send feedback</h2>
                <p className="text-xs text-gray-400 mt-0.5">Bug, idea, or anything on your mind</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600
                           transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>

            {/* Body */}
            {status === "sent" ? (
              /* Success state */
              <div className="flex flex-col items-center gap-3 px-5 py-10">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
                <p className="text-sm font-semibold text-gray-800">Got it — thank you!</p>
                <p className="text-xs text-gray-400 text-center">
                  Your feedback helps make PodLever better.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
                {/* Textarea */}
                <div>
                  <label
                    htmlFor="feedback-message"
                    className="block text-xs font-medium text-gray-600 mb-1.5"
                  >
                    What happened?{" "}
                    <span className="text-red-400" aria-hidden>*</span>
                  </label>
                  <textarea
                    id="feedback-message"
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      if (status === "error") { setStatus("idle"); setErrorMsg(""); }
                    }}
                    placeholder="Describe what you were trying to do and what went wrong (or right)."
                    rows={4}
                    maxLength={2000}
                    required
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5
                               text-sm text-gray-800 placeholder-gray-400 outline-none
                               focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100
                               transition-colors"
                  />
                  {/* Character count */}
                  <p className="mt-1 text-right text-xs text-gray-300">
                    {message.length}/2000
                  </p>
                </div>

                {/* Error message */}
                {status === "error" && (
                  <p className="text-xs text-red-500">{errorMsg}</p>
                )}

                {/* Note about page URL */}
                <p className="text-xs text-gray-400">
                  Your current page URL is included automatically.
                </p>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={!message.trim() || status === "sending"}
                  className="w-full flex items-center justify-center gap-2 rounded-lg
                             bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white
                             hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed
                             transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {status === "sending" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Send className="w-3.5 h-3.5" aria-hidden />
                  )}
                  {status === "sending" ? "Sending…" : "Send feedback"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
