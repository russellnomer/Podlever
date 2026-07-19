---
name: PodLever episode processing pipeline
description: Architecture decisions for the episode upload → AI processing → asset delivery pipeline (Task #2).
---

# PodLever Episode Processing Pipeline

## Architecture

**Upload flow (Server Action → GCS → background):**
- `uploadEpisodeAction` in `app/actions/episode.actions.ts` accepts FormData with title + audio File
- Max audio size: 25 MB (OpenAI Whisper hard limit); configured via `next.config.ts` `serverActions.bodySizeLimit: "50mb"`
- Audio saved to GCS via `lib/storage.ts` (`uploadAudioBuffer`) under `audio/{episodeId}/original.{ext}`
- `episodes.audio_storage_key` stores the GCS path (added via migration `0003_absurd_silk_fever.sql`)
- A `cleaned_audio` asset row is created pointing to the GCS key
- Episode FSM: draft → processing immediately; `after()` fires background fetch to process route

**Processing route (internal, CRON_SECRET auth):**
- `POST /rpc/episodes/[id]/process` — never called by browser directly
- Downloads audio from GCS, sends to `gpt-4o-mini-transcribe` for transcription
- Generates 4 assets in parallel: show_notes, blog_post, social_post, guest_media_pack via `gpt-5.6-luna`
- Text asset content stored in `assets.content` column (not GCS) for fast page rendering
- FSM: processing → ready on success; on error, logs and leaves in "processing" (no failed state yet)

**Asset storage:**
- `assets.content` text column added for text-based assets (transcript, show_notes, blog_post, social_post, guest_media_pack)
- Binary assets (cleaned_audio) use `assets.storage_key` pointing to GCS

**UI:**
- `/dashboard/episodes` — episode list with status badges
- `/dashboard/episodes/new` — EpisodeUploadForm client component (FormData → server action)
- `/dashboard/episodes/[id]` — detail page with StatusPoller (polls router.refresh() every 5s while processing)

## Key decisions

**Why `after()` not `unstable_after()`:** Next.js 15.3+ graduated the API to stable `after` from `next/server`.

**Why direct upload through Server Action (not presigned URL):** Simpler for beta; avoids GCS V4 signing complexity in Replit's sidecar environment. Revisit if audio files exceed 50MB.

**Why content in DB (not GCS for text assets):** Avoids extra GCS fetch per page render. Text assets are small (< 10KB each). Binary assets (audio/video) still use GCS.

**Why no "failed" FSM state:** Not in the current state enum; adding requires a schema migration + all transition table updates. Deferred to post-beta. Stalled episodes (stuck in processing) are visible to owner on detail page.

**Background processing URL:** `http://localhost:${process.env.PORT ?? 3000}/rpc/episodes/{id}/process` — works in Replit's persistent Node.js process; not suitable for serverless.
