/**
 * lib/openai.ts — OpenAI client for PodLever (via Replit AI Integrations proxy)
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #2 — Episode processing pipeline)
 *
 * Dependencies: openai, Replit AI Integrations (AI_INTEGRATIONS_OPENAI_* env vars)
 *
 * HUMAN REVIEW NOTES:
 * Uses Replit's AI Integrations proxy — no user-supplied API key needed.
 * Billing goes through Replit credits. The base URL and key are injected
 * as secrets (AI_INTEGRATIONS_OPENAI_BASE_URL, AI_INTEGRATIONS_OPENAI_API_KEY).
 *
 * Model selection per the AI integrations skill:
 *   - Transcription: gpt-4o-mini-transcribe (audio → text, batch, non-latency-sensitive)
 *   - Asset generation: gpt-5.6-luna (cost-sensitive, high-volume text generation)
 *
 * SECURITY: server-only — never import from client components.
 */

import "server-only";
import OpenAI from "openai";

/** Singleton OpenAI client routed through the Replit AI Integrations proxy. */
export const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

/**
 * MODELS — centralised model names so any future swap is a single-line change.
 * Never hardcode model strings at call sites; always import from here.
 */
export const MODELS = {
  /** Speech-to-text: audio file → verbatim transcript */
  transcription: "gpt-4o-mini-transcribe" as const,
  /** Text generation: cost-effective for high-volume show notes / blog / social copy */
  generation:    "gpt-5.6-luna" as const,
} as const;
