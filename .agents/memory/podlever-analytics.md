---
name: PodLever analytics
description: First-party analytics event tracking, UTM attribution, and admin funnel dashboard (Task #15).
---

# PodLever Analytics

## Architecture
In-house, PII-free, server-side only — no third-party scripts.

**Table:** `analytics_events` — `id`, `user_id` (nullable FK SET NULL), `session_id`, `event_name`, `properties` (jsonb), `created_at`.
**UTM columns:** `users.utm_source/utm_medium/utm_campaign/utm_content` — set on first INSERT in auth callback (first-touch attribution, never overwritten).

## trackEvent API
`lib/analytics.ts` exports:
- `trackEvent(eventName, payload)` — async, never throws, swallows errors
- `trackServerEvent(eventName, userId, properties)` — void wrapper for fire-and-forget

**Always call as `void trackEvent(...)` or `trackServerEvent(...)` — never await in hot paths.**

## Events wired
- `signup` — auth/callback on INSERT detection (createdAt ≈ updatedAt within 5s)
- `auth.login` — auth/callback on every login
- `episode_created` — uploadEpisodeAction after episode row created
- `episode_processed` — process route after FSM → ready
- `upgrade_prompt_shown` — /dashboard/episodes/new when usage.atLimit
- `subscription_started`, `subscription_cancelled` — Stripe webhook (Task #14, not yet wired)

## UTM capture
Middleware reads UTM params from URL query string on first visit and stores in `podlever_utm` cookie (JSON, httpOnly: false, 30 days, first-touch only — never overwrites). Auth callback reads `podlever_utm` cookie and writes to `users.utm_*` columns on user INSERT.

## Admin dashboard
`/admin/analytics?days=30` — server-rendered, no charting lib. Shows:
- Conversion funnel table (page_view → signup → invite_claimed → episode_processed → subscribed)
- Daily signups sparkline (text-based bar chart)
- Top UTM sources table

## Key files
- `db/schema/analytics-events.ts` — table + ANALYTICS_EVENTS constants
- `lib/analytics.ts` — trackEvent, trackServerEvent
- `app/admin/analytics/page.tsx` — admin dashboard
- `middleware.ts` — UTM cookie capture via captureUtmParams()
