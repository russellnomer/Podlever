# ⚠️  DO NOT CREATE ROUTE HANDLERS HERE

This directory exists as a structural placeholder. **No `route.ts` file may ever be created inside `app/api/`.**

## Why

The Replit workspace shared proxy routes `/api/*` to the `api-server` artifact (Express, port 8080).
Any Next.js Route Handler placed under `app/api/` would be intercepted by the proxy and **never reach PodLever's Next.js server** — the handler would silently fail with no error.

This is not a temporary constraint. The proxy configuration is workspace-wide and is not PodLever's to change.

## Where to put Route Handlers instead

All PodLever Route Handlers use the `/rpc/` prefix:

```
app/rpc/billing/webhook/route.ts   ← Stripe webhooks
app/rpc/billing/checkout/route.ts  ← Checkout session creation
app/rpc/upload/audio/route.ts      ← File upload
app/rpc/jobs/status/route.ts       ← Job status polling / SSE
```

Auth routes are at `/auth/` (not `/rpc/`) because they pre-date this decision and were placed there specifically to avoid the `/api/` conflict (see ADR-0001 § Proxy Routing Conflict).

## Decision record

See `docs/adr/0001-architecture.md` § "Proxy Routing Conflict" for the full rationale, options considered, and why `/rpc/` was selected over the alternatives.
