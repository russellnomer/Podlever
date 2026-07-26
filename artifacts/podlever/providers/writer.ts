/**
 * providers/writer.ts — Claude writing provider (show notes + derived text assets)
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (Phase 1B — pipeline engine, writing slice)
 *
 * Dependencies: config (ANTHROPIC_API_KEY), native fetch (Node 22+)
 *
 * HUMAN REVIEW NOTES:
 * Step 2 of the pipeline: turn a transcript into publish-ready text. This provider
 * wraps the Anthropic Messages API directly via native `fetch` (no SDK dependency).
 *
 * The provider is deliberately generic: it takes a system prompt + transcript and
 * returns text. The specific prompts for each asset type (show notes, blog post,
 * social posts) live in `@/services/prompts` so they can be tuned without touching
 * the transport layer. This mirrors the transcription provider's "one provider,
 * one external system" contract.
 *
 * Verified: the show-notes prompt was run against a real transcript and produced a
 * structured title/summary/takeaways/chapters/promo block. See the pipeline service.
 */

import "server-only";

import { config } from "@/config";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A completed Claude generation. */
export type WriteResult = {
  /** The generated text (assistant message content). */
  text: string;
  /** Resolved model name. */
  model: string;
  /** Token usage, when reported by the API. */
  usage: { inputTokens: number; outputTokens: number } | null;
};

/** Options for a single write call. */
export type WriteOptions = {
  /** System prompt — the role/instructions for this asset type. */
  system: string;
  /** User content — typically the transcript plus task framing. */
  user: string;
  /** Max output tokens. Defaults to 1500. */
  maxTokens?: number;
  /** Sampling temperature in [0, 1]. Defaults to 0.4 (consistent, low-drift copy). */
  temperature?: number;
};

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when Anthropic returns a non-2xx response or an unparseable body. */
export class WriterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WriterError";
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────────

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Sonnet 4.5 — the writing model locked for PodLever. */
const MODEL = "claude-sonnet-4-5-20250929";

/**
 * write — Run a single Claude generation for one text asset.
 *
 * @param opts - {@link WriteOptions} (system prompt, user content, limits).
 * @returns A {@link WriteResult} with generated text and usage.
 * @throws {WriterError} on API error or malformed response.
 */
export async function write(opts: WriteOptions): Promise<WriteResult> {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.4,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body,
    });
  } catch (cause) {
    throw new WriterError(`Anthropic request failed: ${(cause as Error).message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new WriterError(
      `Anthropic returned ${res.status}: ${detail.slice(0, 500)}`,
      res.status,
    );
  }

  const json = (await res.json()) as AnthropicResponse;
  const text = json?.content?.find((b) => b.type === "text")?.text;

  if (typeof text !== "string" || text.length === 0) {
    throw new WriterError("Anthropic response missing text content");
  }

  return {
    text,
    model: json.model ?? MODEL,
    usage: json.usage
      ? {
          inputTokens: json.usage.input_tokens ?? 0,
          outputTokens: json.usage.output_tokens ?? 0,
        }
      : null,
  };
}

// ─── Anthropic response shape (partial — only fields we consume) ─────────────────

type AnthropicResponse = {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
