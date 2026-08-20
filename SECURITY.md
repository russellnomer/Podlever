# Security Policy — PodLever

## Classification

**Public** GitHub repository (`is_private: false` on GitHub). Assume source, comments, and historical env **names** are world-readable. Production credentials live only in the host secret store.

Owner: Russell Nomer / Russell Nomer Consulting.

This policy is **high-level**. It does not include exploit steps or copyable payloads.

## Reporting

Email **help@russellnomerconsulting.com**. Do not file a public issue that includes tokens, session cookies, or a working auth bypass.

## Data handled

- Replit account identifiers and session cookies for signed-in users
- Waitlist emails and invite state
- Episode audio, transcripts, derived assets, usage counters
- Stripe customer and subscription identifiers
- Optional Gmail send-as configuration for invites

Treat uploaded audio as **customer content**.

## Authentication (high level)

- Replit OIDC (PKCE) with a documented production callback URL
- Encrypted session cookie (iron-session) keyed by `SESSION_SECRET`
- Owner role derived from `OWNER_REPLIT_USER_ID` — must be set in autoscale
- Invite / waitlist gate before dashboard access
- Stripe webhooks verified with a signing secret

## Secrets (names only)

From `SECRETS_MANIFEST.txt` (application names; toolchain noise omitted):

- `DATABASE_URL`, `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT`
- `SESSION_SECRET`
- `CRON_SECRET`
- `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`
- `GMAIL_SERVICE_ACCOUNT_KEY`, `GMAIL_IMPERSONATE_USER`, `INVITE_FROM_EMAIL`
- `STRIPE_SECRET_KEY`, `STRIPE_LIVE_SECRET_KEY`, `STRIPE_LIVE_Publishable_Key`
- `Stripe_secret_key_dev`, `Stripe_Publishable_key_dev`

Also required in production (documented in `.env.example`, not all in the manifest snapshot): `OWNER_REPLIT_USER_ID`, `OIDC_CALLBACK_URL`, `STRIPE_WEBHOOK_SECRET`.

**Never commit values.** Gmail service-account JSON is a full credential.

## Attack surface (high level)

- Public site `podlever.com` (login, waitlist, dashboard, billing)
- OIDC callback
- Stripe webhook
- Object-storage upload/download paths
- Media processing (ffmpeg) on user files
- Invite email sending
- `/rpc/` app routes vs `/api/` workspace proxy — mis-routing can leak or 500

## Defensive notes (no exploit steps)

- Keep the OIDC redirect URI aligned with the live hostname; a stale workspace domain breaks login and can send users to the wrong callback.
- Session cookies must be set with a method that survives reverse-proxy redirects.
- Sign storage uploads in a trusted sidecar or server; do not ship a private object-storage key in the autoscale image.
- Metering (trial lifetime cap, monthly episode caps) is a billing-integrity control as well as a product rule.
- Rate-limit exports and transcription jobs.
- Webhook signature verification is required for plan upgrades.

## Contact

help@russellnomerconsulting.com
