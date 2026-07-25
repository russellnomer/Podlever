---
name: PodLever beta invite flow
description: Waitlist invite gate, self-declaration, session betaAccess field, /admin/waitlist, OWNER_REPLIT_USER_ID production requirement.
---

# PodLever Beta Invite Flow

## Architecture

Two paths on `/verify-access`:
1. **Claim invite** — user enters the email they used on the waitlist. `claimBetaInviteAction` looks up `waitlist` by email + status "invited", links `replitUserId`, sets `session.betaAccess = "invited"`, redirects to `/onboarding`.
2. **Request access** — `requestAccessAction` inserts email with status "new" + source "verify_access". Owner reviews at `/admin/waitlist` and clicks "Invite" to promote the entry.

On `/onboarding`, `activateBetaUserAction` transitions "invited" → "active", sets `session.betaAccess = "active"`, updates `users.plan = "beta"`, redirects to `/dashboard/episodes/new`.

## Session betaAccess field

Set at login time (`/auth/callback`) by querying `waitlist WHERE replit_user_id = ?`. Returning users with "invited"/"active" status get the right value immediately. New users land on `/verify-access`.

Middleware routing:
- `betaAccess = undefined` → `/verify-access`
- `betaAccess = "invited"` → `/onboarding`
- `betaAccess = "active"` → full product access
- `role = "owner"` → always passes through (no betaAccess check)

## OWNER_REPLIT_USER_ID — CRITICAL for production

`getOwnerReplitUserId()` checks `OWNER_REPLIT_USER_ID` first, then `REPLIT_USERID`. `REPLIT_USERID` is only auto-injected in the **dev workspace** — it is NOT available in Cloud Run / Autoscale.

**If `OWNER_REPLIT_USER_ID` is not set in production**, the owner logs in as `role: "user"` and hits the invite gate. This is confirmed: owner's replitUserId = `19531679`; env var set to production as of Jul 24 2026.

**Rule:** Any future deploy to a new production environment MUST set `OWNER_REPLIT_USER_ID` as a production env var before launch.

## /admin/waitlist

Owner-only page at `/admin/waitlist`:
- Shows all entries with status badges, "linked" (replitUserId claimed) indicator, source, date
- One-click "Invite" button for new/contacted/qualified entries → calls `inviteWaitlistEntryAction`
- Status summary counts (new requests, invited, active)

Server action: `app/actions/admin.actions.ts` → `inviteWaitlistEntryAction`.

## Email notifications: NOT configured

No email service is set up. When the owner invites a user, they must manually tell them to visit podlever.com, sign in with Replit, and enter their email on `/verify-access`.

## Error/success feedback

`/verify-access/page.tsx` reads `searchParams` (Next.js 15 async pattern) and renders banners for all `?error=` and `?message=` values. Every form path has a visible outcome — no silent re-renders.

Error codes: `not_invited`, `already_claimed`, `already_requested`, `already_invited_claim`, `invalid_email`, `lookup_failed`, `link_failed`.
Success: `?message=request_sent`.

## AUTH_PATHS trailing-slash outage (historical)

`AUTH_PATHS` entries must NOT have trailing slashes: `["/auth", "/verify-access", "/waitlisted", "/onboarding"]`. `isAuthPath` adds `"/"` itself via `startsWith(p + "/")`. A trailing slash in the list causes a double-slash match that never fires → protected routes.
