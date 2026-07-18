# PodLever Phase 1A Security Scan Report

**Date:** 2026-07-18
**Task:** #6 — Phase 1A Foundation Audit
**Scanners:** runDependencyAudit · runSastScan · runHoundDogScan

---

## Summary

| Scanner | Status | Critical | High | Moderate | Low |
|---------|--------|----------|------|----------|-----|
| Dependency Audit | ✅ Clean | 0 | 0 | 0 | 0 |
| SAST Scan | ✅ Clean | 0 | 0 | 0 | 0 |
| HoundDog (dataflow) | ✅ Clean | 0 | 0 | 0 | 0 |

**All three scanners returned zero findings.** No vulnerable dependencies, no SAST code findings, no secret/PII dataflow violations.

---

## Architect Code Review Findings

The automated scanners were supplemented with a manual architect review of the 7 highest-risk focus areas. Four issues were identified and remediated in this task.

### Remediated in Task #6

| # | Severity | Area | Finding | Fix Applied |
|---|----------|------|---------|-------------|
| R1 | High | Auth | PKCE cookie deletion used wrong path (`/auth` on set, but deletion didn't specify path → browser silently ignores) | `response.cookies.set("podlever_pkce", "", { path: "/auth", maxAge: 0, ... })` with explicit path matching |
| R2 | High | Auth | `app/auth/callback/route.ts` read `process.env.OWNER_REPLIT_USER_ID` / `REPLIT_USERID` directly instead of through the centralized auth provider layer | Moved to `getOwnerReplitUserId()` in `providers/auth.ts`; callback imports this function |
| R3 | High | FSM | FSM executor episode SELECT and UPDATE queries lacked `AND owner_id = ownerId` predicate (defense-in-depth gap below service-layer auth check) | Added optional `ownerId` to `ExecuteTransitionInput`; `EpisodeService.transitionEpisode` passes it; executor builds owner-scoped `episodeCondition` for all episode queries |
| R4 | Medium | Input | `getEpisodeAction(episodeId: string)` passed raw string to DB layer; invalid UUID would produce a PostgreSQL error that could leak schema details | Added `EpisodeIdSchema.parse(episodeId)` (Zod UUID validation) at the Server Action boundary |
| R5 | Medium | UI | `app/page.tsx` stored and displayed raw `(err as Error).message` from DB connectivity check | DB error now logged server-side; generic `"Database connectivity check failed — check server logs."` returned to UI |

### Accepted Risks (Not Fixed — Documented)

| # | Severity | Finding | Rationale | Phase 1B Action |
|---|----------|---------|-----------|-----------------|
| A1 | High | No rate limiting on `/auth/login` | Requires edge middleware or in-memory/Redis store not yet provisioned. Single-owner internal tool; not public-facing. | Implement IP-based sliding window before any multi-user or public exposure. |
| A2 | Medium | Several `process.env` reads in `providers/auth.ts` outside `config/index.ts` | `SESSION_SECRET`, `REPL_ID`, `REPLIT_DEV_DOMAIN`, `OIDC_CALLBACK_URL`, `REPLIT_DOMAINS` are read lazily at call time (not module load) by documented design. Reading them through `config` would force module-load evaluation. Exception list is documented in `config/index.ts`. | Revisit if config architecture changes in Phase 1B. |
| A3 | Medium | Logout is GET (no CSRF protection) | Single-owner tool; logout CSRF has no meaningful attack surface when only one user can log in. | Convert to POST + CSRF token if multi-user support is added. |

### Verified Correct (Pass)

| Area | Verdict | Notes |
|------|---------|-------|
| Owner guard boundary | ✅ Pass | `requireOwner()` at all 4 Server Actions; services never read cookies |
| FSM executor correctness | ✅ Pass | SELECT-first idempotency; OCC rolls back atomically; 28/28 assertions confirmed |
| Repository owner-scoping (reads) | ✅ Pass | All episode queries include `WHERE owner_id = ?` |
| Input validation (createEpisode, transitionEpisode) | ✅ Pass | Zod schema.parse() in service layer |
| Session cookie security | ✅ Pass | httpOnly, SameSite=Lax, secure in prod, AES-256-GCM |
| OIDC token validation | ✅ Pass | openid-client validates signature, issuer, audience, nonce, state, expiry |
| Structured audit logs | ✅ Pass | auth.login and auth.logout events; no PII in logs |
| DB parameterization | ✅ Pass | Drizzle ORM; no raw SQL concatenation |
| Secrets management | ✅ Pass | SESSION_SECRET, DATABASE_URL via Replit Secrets; no hardcoded values |

---

## Validation After Remediation

```
pnpm --filter @workspace/podlever run typecheck  →  0 errors
pnpm --filter @workspace/podlever run verify-fsm →  28/28 assertions passed
```
