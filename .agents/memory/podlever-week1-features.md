---
name: PodLever Week-1 Feature Build
description: Architecture decisions for the 8-feature gap-closure build (audio cleanup, revision, ZIP, guest pack PDF, job queue, Founding Member, shareable links, COGS)
---

# Week-1 Feature Architecture

## Waitlist Bug Fix
- Root cause: Drizzle `onConflictDoNothing({ target })` was the suspect; switched to bare `onConflictDoNothing()` (no target arg) — generates simpler ON CONFLICT DO NOTHING SQL.
- Added raw-SQL fallback path in the catch block to isolate Drizzle vs DB issues.
- Now logs full error chain: `err.message + err.cause + err.stack` (previously only `err.message`).

## Job Queue (replaces after() as sole executor)
- Table: `job_queue` (migration 0008)
- Worker: `POST /rpc/queue/worker` (CRON_SECRET auth)
- Stale recovery: `GET /rpc/queue/worker` — resets jobs stuck in "running" > 10 min
- `after()` retained as a trigger-only mechanism (fast POST to worker), NOT as the executor
- Job enqueued BEFORE `after()` fires — survives worker trigger failures
- Exponential backoff: 30s → 5min → 30min between retries

## Audio Cleanup (Dolby.io)
- Graceful fallback if `DOLBY_API_APP_KEY` / `DOLBY_API_APP_SECRET` not set
- Flow: auth token → register input URL (signed GCS URL) → submit enhance job → poll → download → GCS upload
- Cleaned audio stored at `audio/{episodeId}/cleaned.wav`; key in `episodes.cleaned_audio_storage_key`
- Cost: $0.003/min audio (vs Auphonic $0.0072/min)

## COGS Tracking
- Table: `episode_cogs` (migration 0008); per-call, never deleted
- Helper: `lib/cogs.ts` — `recordCogs()`, `estimateAudioCost()`, `estimateTokenCost()`
- Admin dashboard: `/admin/cogs`
- **Why:** gpt-5.6-luna pricing is estimated from GPT-4o rates ($2.50/1M in, $10/1M out). Update when Replit publishes exact rates.
- Target COGS: < $0.05/episode for Pro plan ($19/mo, 10 eps = $1.90 revenue each)

## PDF Generation
- Library: pdfkit (server-side, no browser dependency)
- File: `lib/pdf/guest-pack.ts`
- `letterSpacing` is NOT a pdfkit TextOption (caused TS error) — just omit it
- PDF stored at `pdfs/{episodeId}/guest-pack.pdf`; served via signed GCS redirect
- On-demand generation for legacy episodes that predate this feature

## ZIP Export
- Library: jszip
- File: `lib/zip-export.ts`
- Folder: `podlever-{slug}/` containing: transcript.txt, show-notes.md, blog-post.md, social-posts.md, guest-media-pack.md, original-audio.{ext}, cleaned-audio.wav, _meta.json
- Route: `GET /api/episodes/[id]/zip`

## Shareable Links
- Column: `episodes.share_token` (UUID, unique, nullable) — added in migration 0008
- Routes: `POST /api/episodes/[id]/share-token` (generate), `DELETE ...` (revoke)
- Public page: `/share/[token]` — shows show notes + transcript preview + viral CTA
- OG meta tags included for social sharing cards

## Asset Regeneration
- Server Action: `app/actions/regenerate.actions.ts`
- Limits: free=0, pro=3/episode, agency=unlimited
- Tracked via `usage_events` with `event_type = "asset_regenerated"` (added to UsageEventType)
- RegenerateButton client component updates textarea in-place (no page reload)

## Owner Guard Extension
- Added `plan: string` to `OwnerIdentity` — fetched alongside `sessionVersion` in one DB query
- **Why:** avoids a second DB round-trip in every server action that needs the plan

## Schema Changes (migration 0008)
- `job_queue` table
- `episode_cogs` table  
- `episodes.share_token` (UUID unique nullable)
- `episodes.cleaned_audio_storage_key` (text nullable)
- `asset_type` enum: added `guest_media_pack_pdf`
- `USAGE_EVENT_TYPES`: added `asset_regenerated`

## New Routes Summary
- `POST /rpc/queue/worker` — claim and process one job
- `GET /rpc/queue/worker` — stale job recovery (cron)
- `GET /api/episodes/[id]/zip` — bulk ZIP download
- `GET /api/episodes/[id]/guest-pack` — PDF download
- `POST /api/episodes/[id]/share-token` — enable sharing
- `DELETE /api/episodes/[id]/share-token` — revoke sharing
- `/share/[token]` — public shareable episode page
- `/dashboard/welcome` — Founding Member welcome page
- `/admin/cogs` — COGS admin dashboard

## Outstanding
- `DOLBY_API_APP_KEY` + `DOLBY_API_APP_SECRET` secrets NOT yet configured → audio cleanup silently skipped
- `FOUNDING_MEMBER_DISCORD_URL` env var not set → Discord section shows placeholder
- Stripe products still unverified for `metadata.plan_slug` → checkout may fall back to mailto
