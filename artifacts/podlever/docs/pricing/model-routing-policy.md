# PodLever — AI Model Routing Policy
**Status:** Approved
**Date:** 2026-07-18
**Authority:** Unit Economics Audit (2026-07-18) + Pricing Model v2.1
**Applies to:** Task #2 (pipeline build) and all future AI-consuming features

This document is the authoritative model routing specification. Any code that calls an AI
provider on behalf of a Managed AI user MUST comply with this policy. BYOK users route
through their own keys and are exempt — but the retry and ceiling rules still apply.

---

## Transcription

| Priority | Model | Provider | Cost/60-min episode | Use when |
|---|---|---|---|---|
| **Primary** | Universal-3.5 Pro | AssemblyAI | ~$0.08 | All Managed AI episodes |
| **Fallback** | Universal-2 | AssemblyAI | $0.02 | Primary unavailable / rate-limited |
| **Emergency** | Whisper-1 | OpenAI | $0.36 | AssemblyAI fully down |

Never use AssemblyAI Medical Mode for standard podcast episodes (unnecessary cost).

---

## LLM — Content Generation

| Priority | Model | Provider | Input $/MTok | Output $/MTok | Cache Read $/MTok |
|---|---|---|---|---|---|
| **Primary** | Haiku 4.5 | Anthropic | $1.00 | $5.00 | $0.10 |
| **Escalation** | Sonnet 5 | Anthropic | $3.00* | $15.00* | $0.20 |
| **Never (Managed AI)** | Opus 4.8, Fable 5, gpt-5.5, gpt-5.5-pro | Any | — | — | — |

*Budget at post-introductory Sonnet 5 rates ($3/$15) regardless of current pricing.

### Escalation conditions (Haiku → Sonnet 5)
Escalation is only permitted when ALL of the following are true:
1. Haiku 4.5 output for the specific asset type has a quality score below the defined threshold (to be established during Task #2 evaluation)
2. The user is on Professional or Studio tier (not Free or Creator)
3. The per-episode COGS ceiling has not been hit

Escalation is NOT permitted:
- Automatically on retries (retry with same model at lower temperature first)
- For the entire episode (per-asset-call decision only)
- Without logging the escalation reason and cost delta

---

## Prompt Caching — MANDATORY

**Prompt caching is not optional.** It is a hard architectural requirement for all transcript-context LLM calls.

### Implementation rules
1. **Write the transcript to cache on the first asset call** — do not pass it uncached even once
2. **All subsequent asset calls for the same episode read from cache** — never re-transmit the full transcript as a raw input token
3. **Cache TTL:** Use Anthropic's 5-minute TTL for synchronous pipelines. For async/job pipelines, extend to 1-hour cache if the provider supports it
4. **Verify caching is active:** Log `cache_read_input_tokens` from Anthropic API responses. If this field is 0 on calls 2–10, caching is broken — treat as a P1 bug

### Expected cost impact
Without caching: ~$0.33 LLM cost per episode (Sonnet 5) or ~$0.15 (Haiku 4.5)
With caching: ~$0.14 (Sonnet 5) or ~$0.07 (Haiku 4.5)
**Savings: 50–80% on LLM input costs per episode**

---

## Per-Episode COGS Ceiling

Every Managed AI episode MUST be instrumented with a running COGS tracker.

| Threshold | Action |
|---|---|
| **$1.00** | Log WARNING with episode ID, user ID, COGS breakdown. Alert monitoring. |
| **$1.50** | Hard stop. Mark episode as failed. Send to dead-letter queue for manual review. Do NOT charge the user for a failed episode. |

The tracker must accumulate costs across:
- Transcription API call
- Each LLM asset-generation call (input + output + cache write/read)
- Any retry calls

---

## Retry Policy

| Rule | Value |
|---|---|
| Max retries per asset call | **3** |
| Backoff | **Exponential: 1s, 4s, 16s** |
| Retry on | Transient errors (429, 503, timeout) |
| Do NOT retry on | 400 (bad request), 401 (auth), content policy violations |
| On max retries exceeded | Mark asset as failed; continue remaining assets; log with episode ID |
| On 3+ asset failures in one episode | Dead-letter entire episode; do not charge user |

---

## Per-Tenant Monthly Spend Cap

To prevent runaway costs from a single high-usage tenant:

| Tier | Managed AI episodes included | Soft cap (alert) | Hard cap (block) |
|---|---|---|---|
| Free | 0 (BYOK only) | — | — |
| Creator | 0 (BYOK only) | — | — |
| Professional | 20 (platform), unlimited Managed AI credits | $50/month AI spend | $200/month AI spend |
| Studio | 50 (platform), unlimited Managed AI credits | $150/month AI spend | $500/month AI spend |

Hard cap = suspend Managed AI for the user for the remainder of the billing cycle.
Notify the user 24h before hard cap via in-app banner + email.

---

## Model Selection Audit Cadence

Rates change. This policy must be reviewed when:
- `.agents/skills/unit-economics-guardrail/rates.json` age > 30 days
- Any provider announces a pricing change
- A new model is released that could improve quality/cost ratio

Review process: re-run the unit economics model, update `rates.json`, update this document, update CHANGELOG.

---

## Reference

- Full unit economics audit: `docs/pricing/unit-economics-audit-2026-07-18.md`
- Live rates cache: `.agents/skills/unit-economics-guardrail/rates.json`
- Approved pricing model: `docs/pricing/pricing-model-v2.1-approved.md`
