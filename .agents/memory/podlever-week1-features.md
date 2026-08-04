---
name: PodLever Sprint 1 + Board Items
description: What was built in the Sprint 1 board execution session (2026-08-04) and what remains.
---

## What was built (2026-08-04)

**Critical fixes applied:**
- CSP `unsafe-eval` fix for dev + Stripe domains in `next.config.ts`
- Admin feedback UUID=text join fix (`sql\`${users.id}::text = ${feedback.userId}\``)

**Migration 0013** adds to DB:
- `episodes.audio_enhancement_status` (text: 'enhanced'|'fallback'|'skipped')
- `users.audience_persona` (text, default 'general')
- `users.voice_profile` (text, nullable JSON - Sprint 3)
- `users.logo_storage_key` (text, nullable - Sprint 2)
- `users.hide_podlever_branding` (boolean, default false)

**Sprint 1 🔴 - Completed:**
- `lib/personas.ts` — 7 personas (general + 6 premium), `buildPersonaBlock()`, `resolvePersona()`
- `process/route.ts` — fetches user persona, builds persona-aware SYSTEM_PROMPTS, tracks audioEnhancementStatus
- `regenerate.actions.ts` — same persona injection
- `app/dashboard/settings/page.tsx` + `PersonaSelectorClient.tsx` — persona selector UI
- `app/actions/settings.actions.ts` — `saveAudiencePersonaAction` with plan gating
- Settings link added to DashboardShell nav

**Sprint 1 🔴 - Audio enhancement status:**
- Episodes now track `audioEnhancementStatus` ('enhanced'|'fallback'|'skipped')
- Episode page shows badge: Wand2 icon (enhanced), AlertCircle (fallback), SkipForward (skipped)
- Legacy episodes: inferred from cleanedAudioStorageKey

**Sprint 1 🟠 - Completed:**
- Share page OG tags: real `og:description` from show notes first 160 chars, `og:image`, `twitter:card: summary_large_image`
- Homepage `BeforeAfterSection` — static before/after showing raw transcript → polished blog post

**Sprint 2 🟡 - Partially completed:**
- `lib/pdf/episode-report.ts` — full episode PDF: cover + 4 content sections + branded footer
- `lib/zip-export.ts` — ZIP now includes episode-report.pdf; audio downloads REMOVED (caused prod timeouts); text .md files retained for copy-paste
- ZIP route: fetches `hidePodleverBranding` from user row before building ZIP

**What remains (board priority stack):**
- 🟡 Sprint 2: User logo upload — `logoStorageKey` column added; upload route NOT yet built
- 🟢 Sprint 3: Voice/style calibration — column added, not populated
- 🟢 Sprint 3: Contextual cross-promotion (social panel, guest pack footer, completion email)
- ⚪ Backlog: Quality gate second-pass LLM

## Key architectural decisions

**ZIP audio removal:** Audio files removed from ZIP to fix production Autoscale timeouts (30s limit). Audio is still downloadable via separate signed-URL buttons on the episode page. This is intentional — not a regression.

**Persona injection pattern:** `buildPersonaBlock(persona)` prepended to base prompts as `${personaBlock}\n\n---\n\nCONTENT TYPE INSTRUCTIONS:\n${basePrompt}`. Persona block is first so it sets register before content-type instructions.

**Why:** The ZIP was consistently failing in production because downloading 25-50MB audio from GCS inline during the request exceeded Next.js Autoscale's function timeout.
