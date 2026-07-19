---
name: PodLever usage metering
description: Per-user episode metering, tier limits, upload gate, and admin consumption view (Tasks #56, #57).
---

# PodLever Usage Metering

## Schema
`usage_events` table: `id`, `user_id` (FK→users, CASCADE), `episode_id` (FK→episodes, SET NULL), `event_type` (text), `created_at`.
`users.plan` (text, default "free") — upgraded by Stripe webhooks (#14). Set to "beta" by activateBetaUserAction.

## Tier config
`lib/tiers.ts` is the single source of truth. Defines `TIERS` keyed by plan slug:
- free: 1 ep/month
- beta: 10 ep/month (pro-equivalent, $0 — for invited testers)
- pro: 10 ep/month, $29/mo
- agency: Infinity ep/month, $97/mo

`getTier(plan)` returns the TierDef with safe fallback to "free".

## Recording events
Process route (`/rpc/episodes/[id]/process`) calls `usageRepository.recordUsageEvent(ownerId, episodeId)` after FSM transitions to "ready". Non-blocking (errors logged, not re-thrown).

## Usage gate
`/dashboard/episodes/new` (server component) calls `usageRepository.getUsageSummary(userId)` before rendering. Passes `atLimit`, `planLabel`, `used`, `limit` to `EpisodeUploadForm`. When atLimit=true, form shows an upgrade prompt linking to /pricing.

## Period definition
Current UTC calendar month (1st midnight to now). Stripe webhooks (#14) will refine to exact billing period.

## Admin view
`/dashboard/admin/episodes` — owner-only. Shows all episodes across all users with per-user usage bars. Per-user summary from `usageRepository.listPerUserSummary()` (single GROUP BY query — O(1) DB round trips).

## Key files
- `db/schema/usage-events.ts` — table definition
- `lib/tiers.ts` — tier config
- `repositories/usage.repository.ts` — recordUsageEvent, getUsageSummary, listPerUserSummary
- `app/dashboard/admin/episodes/page.tsx` — admin view
- `app/dashboard/episodes/components/EpisodeUploadForm.tsx` — atLimit prop renders upgrade gate
