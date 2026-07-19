/**
 * margin-health-check.ts
 *
 * Reads the AI rates cache, checks freshness, recomputes expected COGS/episode
 * for the Managed AI primary stack (Haiku 4.5 + AssemblyAI U3.5 Pro, prompt caching),
 * and alerts when projected gross margin drops below the approved floor.
 *
 * Exit codes:
 *   0 — GM ≥ 80% (healthy)
 *   1 — GM 70–80% (WARNING)
 *   2 — GM < 70% (ERROR — pricing action required)
 *   3 — Script error (rates file missing, parse failure, etc.)
 *
 * Usage:
 *   pnpm margin-check            # from workspace root
 *   pnpm margin-check --refresh  # force-attempt rates refresh even if fresh
 *
 * Reference: docs/pricing/model-routing-policy.md — Model Selection Audit Cadence
 *            docs/pricing/unit-economics-audit-2026-07-18.md — COGS model
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * All Managed AI credit price tiers. Source: pricing-model-v2.1-approved.md.
 * GM thresholds are applied independently to each tier — a rate hike that keeps
 * single-credit GM healthy can simultaneously push a pack tier below the floor.
 */
const CREDIT_TIERS: ReadonlyArray<{ label: string; sellPrice: number }> = [
  { label: "Single credit  ($7.00 / ep)", sellPrice: 7.0 },
  { label: "10-ep pack     ($6.50 / ep)", sellPrice: 6.5 },
  { label: "25-ep pack     ($6.00 / ep)", sellPrice: 6.0 },
];

/** GM floor that triggers a WARNING log (80%). Below here, alert monitoring. */
const GM_WARNING_THRESHOLD = 0.8;

/** GM floor that triggers an ERROR log and non-zero exit (70%). Pricing action required. */
const GM_ERROR_THRESHOLD = 0.7;

/** Cache TTL in days (enforced from rates.json `expires_after_days`). Default 30. */
const DEFAULT_CACHE_TTL_DAYS = 30;

/** Fixed overhead per episode (infra + support). From "Good" scenario in unit-economics-audit-2026-07-18.md */
const OVERHEAD_PER_EPISODE_USD = 0.22; // $0.15 infra + $0.07 support

/**
 * Episode assumptions for COGS model (60-minute standard podcast).
 * Source: unit-economics-audit-2026-07-18.md § 2 — Episode COGS Model.
 */
const EPISODE = {
  /** Duration in audio hours */
  audioHours: 1,
  /** Transcript tokens (~150 wpm × 60 min) */
  transcriptTokens: 12_000,
  /** Number of distinct asset-generation LLM calls */
  assetCallCount: 10,
  /** Instruction tokens per asset call (system prompt + task spec) */
  instructionTokensPerCall: 500,
  /** Output tokens per asset call */
  outputTokensPerCall: 800,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface LlmModelRates {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_per_mtok?: number;
  cache_read_per_mtok?: number;
  notes?: string;
}

interface TranscriptionModelRates {
  price_per_audio_hour?: number;
  price_per_minute?: number;
  notes?: string;
}

interface RatesJson {
  last_updated: string; // ISO date string (YYYY-MM-DD)
  expires_after_days: number;
  source_urls: string[];
  llm: {
    anthropic: Record<string, LlmModelRates>;
    openai?: Record<string, LlmModelRates>;
    google?: Record<string, LlmModelRates>;
  };
  transcription: Record<string, TranscriptionModelRates>;
}

interface CogsBreakdown {
  /** Transcription cost in USD */
  transcription: number;
  /** LLM cost in USD (all 10 asset calls with prompt caching) */
  llm: number;
  /** Fixed overhead (infra + support) in USD */
  overhead: number;
  /** Total COGS in USD */
  total: number;
  /** Gross margin as a decimal (0–1) */
  grossMargin: number;
  /** Gross margin as a percentage string */
  grossMarginPct: string;
}

interface CogsDetail {
  cacheWriteCost: number;
  firstCallInputCost: number;
  firstCallOutputCost: number;
  subsequentInputCost: number;
  subsequentCacheReadCost: number;
  subsequentOutputCost: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a path relative to the workspace root (two levels up from scripts/src). */
function workspaceRoot(): string {
  // __dirname is scripts/src in CJS; use process.cwd() when run from workspace root via pnpm
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return resolve(__dirname, "..", "..");
  } catch {
    return process.cwd();
  }
}

/** Compute days elapsed since a given ISO date string. */
function daysSince(isoDate: string): number {
  const updated = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.floor((now - updated) / (1000 * 60 * 60 * 24));
}

/** Format USD amount to 4 decimal places. */
function usd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

// ─── COGS Computation ─────────────────────────────────────────────────────────

/**
 * Compute LLM cost for a single episode using Haiku 4.5 with mandatory prompt caching.
 *
 * Caching model (per routing policy):
 * - Call 1: write transcript to cache (cache_write tokens) + instruction input + output
 * - Calls 2–10: cache_read transcript + fresh instruction input + output (never re-transmit full transcript)
 */
function computeLlmCost(
  haiku: LlmModelRates,
): { cost: number; detail: CogsDetail } {
  const mtok = 1_000_000;

  const cacheWriteRate = haiku.cache_write_per_mtok ?? haiku.input_per_mtok * 1.25;
  const cacheReadRate = haiku.cache_read_per_mtok ?? haiku.input_per_mtok * 0.10;
  const inputRate = haiku.input_per_mtok;
  const outputRate = haiku.output_per_mtok;

  // ── Call 1: write transcript to cache ────────────────────────────────────
  // Transcript tokens are written to cache (billed at cache_write rate)
  const cacheWriteCost =
    (EPISODE.transcriptTokens / mtok) * cacheWriteRate;
  // Instruction tokens billed at normal input rate
  const firstCallInputCost =
    (EPISODE.instructionTokensPerCall / mtok) * inputRate;
  // Output tokens
  const firstCallOutputCost =
    (EPISODE.outputTokensPerCall / mtok) * outputRate;

  // ── Calls 2–10: read transcript from cache ────────────────────────────────
  const subsequentCalls = EPISODE.assetCallCount - 1; // 9 calls
  // Transcript retrieved from cache
  const subsequentCacheReadCost =
    (EPISODE.transcriptTokens / mtok) * cacheReadRate * subsequentCalls;
  // Fresh instruction tokens (not cached — unique per asset call)
  const subsequentInputCost =
    (EPISODE.instructionTokensPerCall / mtok) * inputRate * subsequentCalls;
  // Output tokens
  const subsequentOutputCost =
    (EPISODE.outputTokensPerCall / mtok) * outputRate * subsequentCalls;

  const cost =
    cacheWriteCost +
    firstCallInputCost +
    firstCallOutputCost +
    subsequentCacheReadCost +
    subsequentInputCost +
    subsequentOutputCost;

  return {
    cost,
    detail: {
      cacheWriteCost,
      firstCallInputCost,
      firstCallOutputCost,
      subsequentInputCost,
      subsequentCacheReadCost,
      subsequentOutputCost,
    },
  };
}

/** Raw COGS before sell-price is applied (same for all tiers). */
interface RawCogs {
  transcription: number;
  llm: number;
  overhead: number;
  total: number;
}

/**
 * Compute raw COGS for a 60-minute Managed AI episode (sell-price-agnostic).
 *
 * Primary stack:
 *   - Transcription: AssemblyAI Universal-3.5 Pro
 *   - LLM: Anthropic Haiku 4.5 with mandatory prompt caching
 *   - Overhead: fixed $0.22/episode (infra + support)
 *
 * COGS is identical across credit tiers — only the sell price (and therefore
 * gross margin) differs. Compute once, then derive GM per tier.
 */
function computeRawCogs(rates: RatesJson): {
  raw: RawCogs;
  llmDetail: CogsDetail;
  transcriptionModel: string;
  llmModel: string;
} {
  // ── Transcription ─────────────────────────────────────────────────────────
  const transcriptionKey = "assemblyai-universal-3-5-pro";
  const transcriptionRates = rates.transcription[transcriptionKey];
  if (!transcriptionRates) {
    throw new Error(
      `Transcription model "${transcriptionKey}" not found in rates.json. ` +
        `Available: ${Object.keys(rates.transcription).join(", ")}`,
    );
  }
  const transcriptionCost =
    (transcriptionRates.price_per_audio_hour ?? 0) * EPISODE.audioHours;

  // ── LLM (Haiku 4.5) ───────────────────────────────────────────────────────
  const llmKey = "haiku-4.5";
  const haikuRates = rates.llm.anthropic[llmKey];
  if (!haikuRates) {
    throw new Error(
      `LLM model "anthropic/${llmKey}" not found in rates.json. ` +
        `Available: ${Object.keys(rates.llm.anthropic).join(", ")}`,
    );
  }
  const { cost: llmCost, detail: llmDetail } = computeLlmCost(haikuRates);

  const totalCogs = transcriptionCost + llmCost + OVERHEAD_PER_EPISODE_USD;

  return {
    raw: {
      transcription: transcriptionCost,
      llm: llmCost,
      overhead: OVERHEAD_PER_EPISODE_USD,
      total: totalCogs,
    },
    llmDetail,
    transcriptionModel: transcriptionKey,
    llmModel: `anthropic/${llmKey}`,
  };
}

/**
 * Derive a full CogsBreakdown from raw COGS and a specific sell price.
 * Called once per credit tier in the multi-tier health check loop.
 */
function breakdownForTier(raw: RawCogs, sellPriceUsd: number): CogsBreakdown {
  const grossMargin = (sellPriceUsd - raw.total) / sellPriceUsd;
  return {
    transcription: raw.transcription,
    llm: raw.llm,
    overhead: raw.overhead,
    total: raw.total,
    grossMargin,
    grossMarginPct: `${(grossMargin * 100).toFixed(1)}%`,
  };
}

// ─── Staleness Check & Refresh Attempt ───────────────────────────────────────

/**
 * Attempt to verify that provider pricing URLs are still reachable.
 * Does NOT parse the response — provider pages are JavaScript SPAs that cannot
 * be reliably scraped for structured rate data. The check logs HTTP status so
 * a human can visit the URL and manually update rates.json if stale.
 */
async function checkProviderUrlReachability(
  urls: string[],
): Promise<void> {
  console.log(
    "\n[margin-check] Verifying provider pricing URL reachability...",
  );
  for (const url of urls) {
    try {
      // HEAD request to check reachability without downloading HTML body
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
        headers: {
          // Identify the check clearly to provider access logs
          "User-Agent": "PodLever-MarginHealthCheck/1.0 (automated-pricing-audit)",
        },
      });
      const statusTag =
        response.status >= 200 && response.status < 400 ? "✅" : "⚠️";
      console.log(
        `  ${statusTag}  HTTP ${response.status}  ${url}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ❌  UNREACHABLE  ${url}  (${message})`);
    }
  }
  console.log(
    "[margin-check] ⚠️  Provider pages are not machine-parseable.",
  );
  console.log(
    "[margin-check]    Visit each URL above and update rates.json manually if rates have changed.",
  );
  console.log(
    "[margin-check]    After updating rates.json, bump `last_updated` to today's date (YYYY-MM-DD).",
  );
}

/**
 * Stamp the last_updated field of rates.json to today without touching rates.
 * Called only if the operator confirmed rates are still current after manual review.
 */
function stampRatesAsReviewed(
  ratesPath: string,
  rates: RatesJson,
): void {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const updated: RatesJson = { ...rates, last_updated: today };
  writeFileSync(ratesPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  console.log(
    `[margin-check] Rates timestamp updated to ${today} in ${ratesPath}`,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const forceRefresh = process.argv.includes("--refresh");
  const stampReviewed = process.argv.includes("--stamp-reviewed");

  const root = workspaceRoot();
  const ratesPath = resolve(
    root,
    ".agents",
    "skills",
    "unit-economics-guardrail",
    "rates.json",
  );

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║           PodLever — Managed AI Margin Health Check      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`[margin-check] Rates file: ${ratesPath}`);

  // ── Load rates.json ────────────────────────────────────────────────────────
  let rates: RatesJson;
  try {
    const raw = readFileSync(ratesPath, "utf-8");
    rates = JSON.parse(raw) as RatesJson;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[margin-check] ❌ ERROR: Cannot read rates.json — ${message}`,
    );
    console.error(
      `[margin-check]    Expected path: ${ratesPath}`,
    );
    process.exit(3);
  }

  // ── Staleness check ────────────────────────────────────────────────────────
  const ttlDays = rates.expires_after_days ?? DEFAULT_CACHE_TTL_DAYS;
  const ageInDays = daysSince(rates.last_updated);
  const isStale = ageInDays > ttlDays;

  console.log(
    `[margin-check] Rates last_updated: ${rates.last_updated}  ` +
      `(${ageInDays} days ago, TTL ${ttlDays} days)`,
  );

  if (isStale || forceRefresh) {
    const reason = forceRefresh && !isStale ? "--refresh flag" : "cache expired";
    console.warn(
      `\n[margin-check] ⚠️  WARNING: Rates cache is stale (${reason}). ` +
        `Manual review required.`,
    );
    await checkProviderUrlReachability(rates.source_urls);
  } else {
    console.log(
      `[margin-check] ✅ Rates cache is fresh (${ageInDays}/${ttlDays} days used).`,
    );
  }

  if (stampReviewed) {
    stampRatesAsReviewed(ratesPath, rates);
  }

  // ── Compute COGS (sell-price-agnostic — same for all tiers) ──────────────
  console.log(
    "\n[margin-check] Computing COGS for primary stack " +
      "(AssemblyAI U3.5 Pro + Haiku 4.5 + prompt caching)...",
  );

  let raw: RawCogs;
  let llmDetail: CogsDetail;
  let transcriptionModel: string;
  let llmModel: string;

  try {
    ({ raw, llmDetail, transcriptionModel, llmModel } = computeRawCogs(rates));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[margin-check] ❌ ERROR: COGS computation failed — ${message}`);
    process.exit(3);
  }

  // ── Print detailed COGS breakdown (shared across all tiers) ───────────────
  console.log("\n─── COGS Breakdown (60-min episode) ───────────────────────────");
  console.log(`  Transcription  (${transcriptionModel}):  ${usd(raw.transcription)}`);
  console.log(`  LLM            (${llmModel}):            ${usd(raw.llm)}`);
  console.log(`    ├─ Cache write (transcript × 1):        ${usd(llmDetail.cacheWriteCost)}`);
  console.log(`    ├─ Input call 1 (instruction):          ${usd(llmDetail.firstCallInputCost)}`);
  console.log(`    ├─ Output call 1:                       ${usd(llmDetail.firstCallOutputCost)}`);
  console.log(`    ├─ Cache reads calls 2–10 (×9):         ${usd(llmDetail.subsequentCacheReadCost)}`);
  console.log(`    ├─ Input calls 2–10 (instruction ×9):   ${usd(llmDetail.subsequentInputCost)}`);
  console.log(`    └─ Output calls 2–10 (×9):              ${usd(llmDetail.subsequentOutputCost)}`);
  console.log(`  Overhead       (infra + support):         ${usd(raw.overhead)}`);
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log(`  TOTAL COGS:                               ${usd(raw.total)}`);
  console.log("──────────────────────────────────────────────────────────────");

  // ── Per-tier gross margin health check ────────────────────────────────────
  // Each credit tier has a different sell price ($7.00 / $6.50 / $6.00).
  // Thresholds are applied independently — a rate hike that keeps the
  // single-credit tier healthy can simultaneously breach a pack tier floor.
  console.log("\n─── Gross Margin by Credit Tier ───────────────────────────────");

  const isStaleFlag = isStale ? " [STALE RATES — verify manually]" : "";

  // Track the worst exit code across all tiers; we report all findings before
  // exiting so the operator sees the full picture in a single run.
  let worstExitCode = 0;

  for (const tier of CREDIT_TIERS) {
    const breakdown = breakdownForTier(raw, tier.sellPrice);
    const gm = breakdown.grossMargin;

    let statusTag: string;
    let tierExitCode: number;

    if (gm < GM_ERROR_THRESHOLD) {
      // GM < 70% — pricing action required for this tier
      statusTag = "❌ ERROR  ";
      tierExitCode = 2;
    } else if (gm < GM_WARNING_THRESHOLD) {
      // GM 70–80% — below the 80% design target; alert but not emergency
      statusTag = "⚠️  WARNING";
      tierExitCode = 1;
    } else {
      // GM ≥ 80% — healthy
      statusTag = gm >= 0.9 ? "🟢 EXCL   " : "🟡 OK     ";
      tierExitCode = 0;
    }

    // Keep the most severe exit code seen across all tiers.
    if (tierExitCode > worstExitCode) worstExitCode = tierExitCode;

    console.log(
      `  ${statusTag}  ${tier.label}  →  GM ${breakdown.grossMarginPct}` +
        (tierExitCode > 0 ? isStaleFlag : ""),
    );
  }

  console.log("──────────────────────────────────────────────────────────────");

  // ── Summary & exit ─────────────────────────────────────────────────────────
  if (worstExitCode === 2) {
    console.error(
      `\n[margin-check] ❌ ERROR: One or more credit tiers are BELOW the 70% GM floor.${isStaleFlag}`,
    );
    console.error(
      "[margin-check]    PRICING ACTION REQUIRED: Review credit pack prices against " +
        "current AI provider rates.",
    );
    console.error(
      "[margin-check]    Consult: docs/pricing/pricing-model-v2.1-approved.md",
    );
    process.exit(2);
  } else if (worstExitCode === 1) {
    console.warn(
      `\n[margin-check] ⚠️  WARNING: One or more credit tiers are below the 80% GM target.${isStaleFlag}`,
    );
    console.warn(
      "[margin-check]    Review provider rate changes and consider whether pricing adjustment is needed.",
    );
    console.warn(
      "[margin-check]    Consult: docs/pricing/pricing-model-v2.1-approved.md",
    );
    process.exit(1);
  } else {
    // All tiers healthy
    console.log(
      `\n[margin-check] ✅ All credit tiers are above the 80% GM target.${isStaleFlag}`,
    );
    if (isStale) {
      console.warn(
        "[margin-check] ⚠️  Rates are stale — refresh from provider pages before relying on this result.",
      );
      // Exit 0 when all margins are healthy; staleness is a warning, not a failure.
    }
    process.exit(0);
  }
}

// Run
main().catch((err) => {
  console.error("[margin-check] ❌ Unhandled error:", err);
  process.exit(3);
});
