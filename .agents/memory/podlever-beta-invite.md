---
name: PodLever beta invite flow
description: Architecture for the waitlist invite gate, self-declaration, and session-based access control (Task #55).
---

# PodLever Beta Invite Flow

## Why self-declaration (not auto-match)
Replit OIDC only returns `sub` (replitUserId) in claims — no email. So users are matched to waitlist entries by having them self-declare their email on `/verify-access`. The system checks it against `waitlist.email` where `status = 'invited'`.

## Statuses added to LEAD_STATUSES
`invited` — owner marked them as beta-invited (manual notify, no email infra).
`active` — user completed onboarding; has full product access.

## Schema change
`waitlist.replit_user_id` (text, unique, nullable) — set when user claims invite at `/verify-access`.

## Session field
`PodLeverSession.betaAccess?: "invited" | "active"` — set at `/verify-access` claim and updated at `/onboarding` activation. Owners always bypass beta checks.

## Middleware (middleware.ts)
Reads iron-session cookie without DB query. Rules:
- Public paths / `/auth/*` → always allow
- `/verify-access`, `/waitlisted`, `/onboarding` → always allow
- Owner → full access
- `betaAccess === "active"` → full access
- `betaAccess === "invited"` → redirect to `/onboarding` only
- No betaAccess → redirect to `/verify-access`

## Flow for a new beta user
1. Owner clicks "Invite to beta" in CRM → `inviteToBeta()` sets `status = 'invited'`
2. Owner manually notifies user
3. User signs in with Replit → gets session (no betaAccess yet)
4. Middleware routes them to `/verify-access`
5. User enters waitlist email → `claimBetaInviteAction` links `replit_user_id`, sets session `betaAccess = "invited"`, redirects to `/onboarding`
6. User clicks CTA on `/onboarding` → `activateBetaUserAction` sets `status = 'active'`, session `betaAccess = "active"`, redirects to `/dashboard/episodes/new`

## Key files
- `app/actions/beta.actions.ts` — `claimBetaInviteAction`, `activateBetaUserAction`
- `app/actions/crm.actions.ts` — `inviteToBeta` (owner CRM action)
- `middleware.ts` — route-level access gate
- `repositories/waitlist.repository.ts` — `findInvitedByEmail`, `linkReplitUserId`, `activateBetaUser`, `markLeadInvited`
