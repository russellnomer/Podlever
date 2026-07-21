---
name: PodLever beta access guard
description: requireBetaAccess/requireBetaUser pattern for episode routes; AUTH_PATHS trailing-slash outage root cause; feedback table.
---

# PodLever Beta Access Guard

## The pattern

Two new functions in `providers/owner-guard.ts` (alongside `requireOwner` / `requireOwnerFromSession`):

- `requireBetaAccess(session)` — accepts owners OR `betaAccess === "active"` users. Same 3 gates (auth → role/betaAccess → session version DB check). Returns `UserIdentity` (extends `OwnerIdentity` with `isOwner: boolean`).
- `requireBetaUser()` — reads session from cookies then calls `requireBetaAccess`. Use in Server Actions / Route Handlers.

**Why:** Phase 1A was owner-only throughout. When beta testers were added (betaAccess field in session), all episode routes still blocked them. These guards are the correct replacement for episode operations; CRM/admin/export stays `requireOwner`.

**How to apply:** Use `requireBetaAccess`/`requireBetaUser` for any route that beta testers should reach (episodes, assets, downloads). Keep `requireOwner`/`requireOwnerFromSession` for CRM, admin, billing portal, CSV export.

## Routes affected (now open to active beta users)
- `/dashboard/episodes` — list
- `/dashboard/episodes/new` — upload
- `/dashboard/episodes/[id]` — detail + assets
- All `episode.actions.ts` actions (5 of them)
- `regenerate.actions.ts`
- `api/episodes/[id]/zip`, `share-token`, `guest-pack`

## Data scoping
All episode repository calls use `userId` as the scope key. `listEpisodesForOwner(userId)` and `getEpisodeForOwner(episodeId, userId)` work correctly for any user — the method names are misleading but the queries are userId-scoped, not role-scoped.

## Dashboard routing for non-owners
`/dashboard/page.tsx` checks `user.role !== "owner"` and redirects to `/dashboard/episodes` (previously redirected to `/`). Middleware already allows `betaAccess === "active"` users into `/dashboard/*`.

## AUTH_PATHS trailing-slash outage
**Root cause:** `AUTH_PATHS` had `"/auth/"` (trailing slash). `isAuthPath` appended another `"/"`, looking for `"/auth//"` — never matched. `/auth/login` was treated as a protected route → redirect loop → uptime monitor saw ERR_TOO_MANY_REDIRECTS.

**Fix:** Always use paths WITHOUT trailing slash in `AUTH_PATHS`: `["/auth", "/verify-access", "/waitlisted", "/onboarding"]`. The `isAuthPath` function adds `"/"` itself via `startsWith(p + "/")`.

**Why this matters:** Any future path added to `AUTH_PATHS` must not have a trailing slash.

## Feedback table
`db/schema/feedback.ts` — columns: id (uuid), user_id (text, not FK), display_name, page_url, message, created_at. Migration `0008_loose_sage.sql` applied. Server action: `app/actions/feedback.actions.ts`. Widget: `app/dashboard/components/FeedbackWidget.tsx`. Layout: `app/dashboard/layout.tsx`.

Feedback is stored in DB + emits structured `feedback.submitted` log. No email dependency in Phase 1 alpha.
