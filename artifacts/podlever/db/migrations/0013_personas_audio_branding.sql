-- Migration 0013: Audience personas, audio enhancement status, branding controls
-- Created: 2026-08-04
-- Adds:
--   episodes.audio_enhancement_status  — result of FFmpeg enhancement ('enhanced'|'fallback'|'skipped')
--   users.audience_persona             — account-level audience targeting (6 archetypes + 'general')
--   users.voice_profile                — JSON fingerprint extracted from transcript (Sprint 3)
--   users.logo_storage_key             — GCS key for user-uploaded brand logo (Sprint 2)
--   users.hide_podlever_branding       — Pro/Agency toggle: remove PodLever watermark from PDF

-- Episode: track what actually happened to the audio
ALTER TABLE "episodes"
  ADD COLUMN IF NOT EXISTS "audio_enhancement_status" text;

-- User: audience persona (free tier = 'general' only; Pro/Agency get all 6 archetypes)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "audience_persona" text NOT NULL DEFAULT 'general';

-- User: voice style profile JSON (extracted from transcript on first episode; Sprint 3)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "voice_profile" text;

-- User: brand logo for PDF co-branding (Sprint 2)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "logo_storage_key" text;

-- User: Pro/Agency can hide PodLever watermark from generated PDFs
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "hide_podlever_branding" boolean NOT NULL DEFAULT false;
