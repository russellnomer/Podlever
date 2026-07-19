-- Migration: 0008_job_queue_cogs_share
-- Purpose:   Week-1 ops + product gap closure
--
--   1. job_queue       — Persistent DB-backed job queue replacing after()
--   2. episode_cogs    — Per-call AI cost tracking (COGS audit)
--   3. episodes        — Add share_token (viral shareable links)
--                        Add cleaned_audio_storage_key (Dolby.io output)
--
-- Applied by: pnpm --filter @workspace/podlever run db:migrate
-- Rollback:
--   DROP TABLE IF EXISTS "job_queue";
--   DROP TABLE IF EXISTS "episode_cogs";
--   ALTER TABLE "episodes" DROP COLUMN IF EXISTS "share_token";
--   ALTER TABLE "episodes" DROP COLUMN IF EXISTS "cleaned_audio_storage_key";

-- ─── 1. Persistent job queue ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "job_queue" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_type"      text        NOT NULL,
  "payload"       jsonb       NOT NULL,
  "status"        text        NOT NULL DEFAULT 'pending',
  "priority"      integer     NOT NULL DEFAULT 0,
  "attempts"      integer     NOT NULL DEFAULT 0,
  "max_attempts"  integer     NOT NULL DEFAULT 3,
  "last_error"    text,
  "run_at"        timestamptz NOT NULL DEFAULT now(),
  "started_at"    timestamptz,
  "completed_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

-- Partial index: only index rows the worker needs to scan.
-- Completed/failed rows are excluded → stays fast as the table grows.
CREATE INDEX IF NOT EXISTS "job_queue_claimable_idx"
  ON "job_queue" ("priority" DESC, "run_at" ASC)
  WHERE "status" IN ('pending', 'retrying');

-- ─── 2. Per-call COGS tracking ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "episode_cogs" (
  "id"            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  "episode_id"    uuid           NOT NULL REFERENCES "episodes"("id") ON DELETE CASCADE,
  "user_id"       uuid           NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "step"          text           NOT NULL,
  "model"         text           NOT NULL,
  "tokens_in"     integer,
  "tokens_out"    integer,
  "audio_seconds" integer,
  "cost_usd"      numeric(10,6)  NOT NULL,
  "created_at"    timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "episode_cogs_episode_id_idx"
  ON "episode_cogs" ("episode_id");

CREATE INDEX IF NOT EXISTS "episode_cogs_user_created_idx"
  ON "episode_cogs" ("user_id", "created_at");

-- ─── 3. Episodes: share token + cleaned audio ─────────────────────────────────

ALTER TABLE "episodes"
  ADD COLUMN IF NOT EXISTS "share_token" uuid UNIQUE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "cleaned_audio_storage_key" text DEFAULT NULL;

-- ─── 4. New asset type: guest_media_pack_pdf ──────────────────────────────────
-- pgEnum values cannot be removed once added. We add and never delete.
ALTER TYPE "asset_type" ADD VALUE IF NOT EXISTS 'guest_media_pack_pdf';
