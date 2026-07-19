# Agent Memory Index

- [PodLever Phase 1A decisions](podlever-phase1a.md) — stack, auth, FSM, repository, and proxy routing decisions for the PodLever Next.js app.
- [PodLever episode pipeline](podlever-episode-pipeline.md) — upload→GCS→Whisper→GPT asset generation architecture; after() for fire-and-forget; text assets in DB not GCS.
- [PodLever beta invite flow](podlever-beta-invite.md) — waitlist invite gate: replitUserId column, self-declaration email claim, session betaAccess field, middleware routing.
- [PodLever usage metering](podlever-usage-metering.md) — usage_events table, per-user episode caps, tiers config, upload gate, admin view. users.plan column drives limits.
- [PodLever analytics](podlever-analytics.md) — analytics_events table, trackServerEvent fire-and-forget, UTM cookie capture in middleware, admin funnel at /admin/analytics.
- [PodLever Stripe integration](podlever-stripe.md) — credential resolution, esbuild __dirname migration gotcha, startup sequence, webhook handling, plan mapping.
- [PodLever Week-1 features](podlever-week1-features.md) — job queue, audio cleanup, COGS, PDF, ZIP, share links, regeneration, Founding Member; schema changes in migration 0008.
