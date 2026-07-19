# PodLever Pricing Model v2.1 — Approved
**Status:** Approved for implementation
**Date:** 2026-07-18
**Supersedes:** v2.0 draft (2026-07-18)
**Authority:** Unit Economics Audit 2026-07-18 + Russell Nomer approval

This is the single source of truth for pricing.
Task #13 (landing page) and Task #14 (Stripe) read exclusively from this document.
Do not embed prices in code without referencing this file.

---

## Philosophy

PodLever sells orchestration, reliability, workflow, and time savings — not raw AI.

Users pay a platform subscription for the system (FSM, asset management, versioning,
dashboard, approvals). AI processing is handled in one of two ways:

- **BYOK (Bring Your Own Key)** — User supplies their own AI API keys and pays providers
  directly. PodLever orchestrates the calls; the user absorbs the compute cost.
- **Managed AI Credits** — User buys compute from PodLever at a marked-up rate. PodLever
  absorbs provider risk, manages reliability, and handles retries transparently.

---

## Platform Tiers

| Tier | Monthly | Annual (18% off) | Annual total | Episodes/mo | AI Mode |
|---|---|---|---|---|---|
| **Free** | $0 | — | — | 3 | BYOK only |
| **Creator** | $39/mo | **$32/mo** | $384/yr | 8 | BYOK |
| **Professional** | $99/mo | **$81/mo** | $972/yr | 20 | BYOK + Managed AI |
| **Studio** | $249/mo | **$204/mo** | $2,448/yr | 50 | BYOK + Managed AI + multi-show/team |

### Annual savings copy (landing page / Stripe checkout)

| Tier | Copy |
|---|---|
| Creator | "Save $84/year — $32/mo billed annually" |
| Professional | "Save $216/year — $81/mo billed annually" |
| Studio | "Save $540/year — $204/mo billed annually" |

### Tier feature summary

**Free ($0)**
- 3 episodes/month, BYOK only
- Full asset suite, watermarked outputs
- Basic version history
- Purpose: evaluation; designed to reach the "aha moment" before the paywall

**Creator ($39/mo · $32/mo annual)**
- 8 episodes/month, BYOK
- Full asset suite, no watermark
- Full version history
- Target: solo podcasters, indie creators

**Professional ($99/mo · $81/mo annual)**
- 20 episodes/month, BYOK + Managed AI credits (purchased separately)
- Priority processing queue
- Target: consultants, serious creators, B2B podcasters

**Studio ($249/mo · $204/mo annual)**
- 50 episodes/month, BYOK + Managed AI credits
- Multi-show management
- Team seats (number TBD — Phase 1B)
- Approval workflows
- Target: small studios, agencies, multi-brand operators

---

## Managed AI Credits

Available to Professional and Studio tier users only.

| Product | Price | Per-episode rate | Notes |
|---|---|---|---|
| Single episode | **$7.00** | $7.00 | Pay-as-you-go |
| 10-episode pack | **$65.00** | $6.50 | 7% volume discount |
| 25-episode pack | **$150.00** | $6.00 | 14% volume discount |

Credits do not expire. Users can mix BYOK and Managed AI freely within a billing period.

---

## Unit Economics

### Planning COGS (conservative floor — intentionally high)

| Component | Planning amount | Actual 2026 range |
|---|---|---|
| Transcription | $0.40 | $0.02–$0.36 depending on provider |
| LLM content generation | $1.20 | $0.07–$0.33 with caching |
| Infrastructure & storage | $0.25 | $0.08–$0.30 |
| Support & retry allocation | $0.15 | $0.04–$0.15 |
| **Total** | **$2.00** | **$0.21–$1.14** |

The $2.00 floor is used for worst-case scenario planning. Do not use it as the operational target.

### Expected actual COGS (recommended model stack, July 2026)

**$0.37–$0.80 per episode → 89–95% gross margin at $7.00**

See `unit-economics-audit-2026-07-18.md` for the full scenario table and sensitivity analysis.

### Model routing

All Managed AI episodes follow `model-routing-policy.md`. Non-negotiable mandates:
- Primary LLM: **Anthropic Haiku 4.5**
- Primary transcription: **AssemblyAI Universal-3.5 Pro**
- **Prompt caching is mandatory** — not optional
- Per-episode hard COGS ceiling: **$1.50** (alert at $1.00)
- Max retries per asset call: **3**

Never use Opus 4.8, Fable 5, gpt-5.5, or gpt-5.5-pro for Managed AI episodes.

---

## Free Tier Guardrails

| Guardrail | Value | Rationale |
|---|---|---|
| Conversion rate KPI | **15% free → Creator within 60 days** | Below this, free tier is a net cost center |
| Free account cap | **500 accounts** before waitlist | Limits unmonitored subsidy exposure |
| Episode tracking | Per-user monthly counter in `users` table | Required for cap enforcement |

If conversion rate falls below 10% at any quarterly review, tighten the free limit
(e.g., 2 episodes/month) before any other intervention.

---

## Pricing Review Cadence

| Trigger | Action |
|---|---|
| `rates.json` age > 30 days | Refresh live rates; recompute COGS; update this doc if materially changed |
| Provider announces a pricing change | Immediate refresh + margin check |
| New model released (Haiku class or cheaper) | Evaluate adoption; update routing policy |
| Actual average COGS/episode > $1.00 | Immediate investigation; routing policy review |
| Quarterly (every 90 days) | Full review: tier prices, credit price, conversion KPIs |

An automated margin health check script is planned (Task #18) to alert when projected
gross margin on Managed AI drops below 80%.

---

## Open Items (future milestones)

| Item | Target milestone |
|---|---|
| Annual billing — Stripe price IDs for each tier | Task #14 |
| Team seat pricing for Studio | Phase 1B post-launch |
| Per-asset AI mode selection (BYOK vs Managed per call) | Phase 2 |
| Storage-based expansion pricing | Phase 2 |
| Overage pricing for subscribers exceeding episode limit | Phase 1B evaluation |
| Refund policy (wording + Stripe configuration) | Task #14 |
| Dunning / failed payment grace period | Task #14 |

---

## Amendment Log

| Date | Change | Authority |
|---|---|---|
| 2026-07-18 | v2.1 approved: $7.00 credit, 18% annual, free-user cap, model routing mandate | Unit economics audit + Russell Nomer |
| 2026-07-18 | v2.0 draft: raised credit price from $6.00 → $7.00 for margin protection | Pricing stress-test |
