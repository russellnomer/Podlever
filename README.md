# PodLever

**PodLever** is a podcast operations product: upload an episode, get transcription, assets, and export packaging without standing up your own ffmpeg + LLM + storage glue. It is built for shows and small studios that want a metered workspace (trial / Pro / Agency), not an unlimited render farm.

Live sites:

- [podlever.com](https://podlever.com)
- [www.podlever.com](https://www.podlever.com)

Owner: **Russell Nomer / Russell Nomer Consulting**.

GitHub currently lists this repository as **public**. Treat production secrets as if the world can read everything except Replit’s secret store.

## Who it is for

- Hosts who will pay for minutes and episode caps instead of hiring an editor for every cutdown
- Agencies (metered: episodes / month, extra-episode overage — not “unlimited”)
- The owner, who admits waitlist users from `/admin/waitlist` (invite is not automatic email unless Gmail secrets are set)

## What it does

- Replit OIDC login, iron-session cookies, invite / waitlist gate (`/verify-access`)
- Episode upload, usage metering (lifetime cap on free trial; monthly caps on paid tiers)
- Transcription (Deepgram or AI proxy), OpenAI-assisted assets, ffmpeg processing
- Object storage for audio (signed upload URLs — private keys stay off the deployment)
- Stripe billing (live + dev key names in the manifest)
- Owner admin: waitlist invite, margin check script
- Gmail API (service account, `gmail.send` only) or SMTP fallback for invite mail from `INVITE_FROM_EMAIL`

Route handlers under the PodLever artifact use a **`/rpc/` prefix**, not `/api/`. The workspace proxy sends `/api/*` to `artifacts/api-server`. See `artifacts/podlever/app/api/README.md`.

**Deploy gotcha:** every artifact needs a `[services.production]` block in `artifact.toml` or it is silently missing in production (HTTP 500, no build error).

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 15 App Router (`artifacts/podlever`) |
| Monorepo | pnpm workspaces, Node.js 24, TypeScript 5.9 |
| Database | PostgreSQL + Drizzle (usage, waitlist, users) |
| Auth | Replit OIDC (PKCE) + iron-session (`SESSION_SECRET`) |
| Media | ffmpeg / ffprobe, Replit object storage / GCS client |
| AI | OpenAI; Deepgram for speech |
| Payments | Stripe + `stripe-replit-sync` |
| Email | Google Workspace Gmail API (domain-wide delegation) |

## How to run

```bash
pnpm install
pnpm --filter @workspace/podlever run dev          # Next on PORT (default 3000)
pnpm --filter @workspace/api-server run dev        # if you need the workspace API
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/db run push               # dev schema
pnpm --filter @workspace/podlever test
pnpm margin-check
```

Copy `artifacts/podlever/.env.example` to a local `.env` (names only in git). Production must set:

- `DATABASE_URL`
- `SESSION_SECRET` (≥ 32 characters)
- `OWNER_REPLIT_USER_ID` (autoscale does not inject `REPLIT_USERID`)
- `OIDC_CALLBACK_URL` (production: `https://podlever.com/auth/callback`)
- Stripe live/dev secret **names** as in the manifest; `STRIPE_WEBHOOK_SECRET` for fulfillment
- Object storage bucket id; optional `DEEPGRAM_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY`
- Optional: `GMAIL_SERVICE_ACCOUNT_KEY`, `GMAIL_IMPERSONATE_USER`, `INVITE_FROM_EMAIL`

## Repo layout

```
artifacts/podlever/          # Next.js product (app/, jobs/, repositories/, services/)
artifacts/api-server/        # workspace API (do not collide /api with PodLever RPC)
lib/                         # shared packages
CHANGELOG.md                 # dated production fixes (auth callback, pricing, storage)
```

## Replit

- Workspace: [https://replit.com/@RussellNomer/PodLever](https://replit.com/@RussellNomer/PodLever)
- GitHub: [https://github.com/russellnomer/Podlever](https://github.com/russellnomer/Podlever)
- Artifact: PodLever (web)

Questions: help@russellnomerconsulting.com
