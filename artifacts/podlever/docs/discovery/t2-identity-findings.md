# T2 — Environment Discovery Findings
**Date:** 2026-07-18  
**Recorded by:** Agent (Phase 1A build)  
**Status:** ✅ Complete — T3 Human Checkpoint required before proceeding to T6

---

## 1. Database Provisioning

| Variable | Status | Value (redacted) |
|---|---|---|
| `DATABASE_URL` | ✅ Verified | `postgresql://postgres:***@helium/heliumdb?sslmode=disable` |
| `SESSION_SECRET` | ✅ Verified | Present in Replit Secrets (>32 chars) |

**Finding:** Replit PostgreSQL is auto-provisioned. `DATABASE_URL` is injected into the process environment. The db schema can be pushed immediately.

---

## 2. Identity Mechanism Discovery

### 2a. Request Header Inspection

A diagnostic Route Handler was deployed at `/api/discovery/headers` and tested via direct HTTP request to the Next.js dev server (port 3000).

**Curl output:**
```json
{
  "mechanism_detected": "NONE_DETECTED",
  "replit_identity_headers": {
    "x-replit-user-id":            null,
    "x-replit-user-name":          null,
    "x-replit-user-roles":         null,
    "x-replit-user-bio":           null,
    "x-replit-user-url":           null,
    "x-replit-user-profile-image": null,
    "x-replit-user-teams":         null,
    "x-replit-identity":           null,
    "x-forwarded-for":             "127.0.0.1",
    "x-forwarded-host":            "localhost:3000",
    "x-forwarded-proto":           "http"
  }
}
```

**Interpretation:** The Replit proxy does NOT inject user identity headers in the current development environment. Neither the legacy proxy-header mechanism nor the Replit Identity JWT (`x-replit-identity`) is active.

### 2b. Process Environment Identity Variables

These ARE present at the process level (not request-scoped):

| Variable | Value | Usability |
|---|---|---|
| `REPLIT_USERID` | `19531679` | Process-level only — not per-request; not usable as auth |
| `REPLIT_USER` | `RussellNomer` | Process-level only — same limitation |

**Interpretation:** These env vars identify the workspace owner but are NOT a per-request identity mechanism. A deployed app with multiple users could not use these to distinguish callers.

### 2c. Managed Clerk

No `CLERK_*` environment variables are present. Managed Clerk has not been provisioned for this workspace.

---

## 3. Proxy Routing Discovery

**Key finding:** The workspace's shared path-based proxy routes `/api/*` to the `api-server` artifact (port 8080). PodLever's own API routes (e.g., `/api/discovery/headers`) are NOT reachable via the shared proxy — they go to the api-server.

**Implication for PodLever:**  
PodLever's Route Handlers must NOT use `/api/` as a path prefix, OR the proxy routing must be updated to give PodLever its own path. Recommend: PodLever claims `previewPath = "/"` and its API routes use `/podlever-api/` or `/rpc/`, OR the proxy is reconfigured in T1 artifact TOML.

**Decision deferred to T3:** Russell must confirm whether the PodLever Next.js app should take over the root path and what to do about the existing api-server `/api` routing conflict.

---

## 4. Platform Behaviors

| Behavior | Finding |
|---|---|
| Next.js 15 boots on Replit | ✅ Verified — `next dev -p ${PORT:-3000} -H 0.0.0.0` works |
| `PORT` binding | ✅ Works — Next.js reads PORT env var; shell expansion in dev script |
| Proxied preview (iframe) | ✅ App serves at port 3000; proxy iframe can reach it |
| `next build` typecheck | ✅ `tsc --noEmit` passes (0 errors) |
| shadcn/ui init | ✅ `components.json` created non-interactively; `lib/utils.ts` exists |

---

## 5. T3 Decision Required

The agent HALTS here. The following decisions require explicit Russell approval before T6 (AuthProvider) is implemented:

### Decision A — Identity Mechanism

Choose one:

| Option | Mechanism | Effort | Notes |
|---|---|---|---|
| **A1** | Replit Auth (OIDC / PKCE) | Medium | Replit first-class support; `replit-auth` skill available; headers available in deployed app if enabled |
| **A2** | Managed Clerk (Replit-managed tenant) | Low-Medium | `clerk-auth` skill available; no API keys needed; richest UX |
| **A3** | Session-based (SESSION_SECRET + custom JWT) | Higher | Full control; no external dependency; SESSION_SECRET already provisioned |
| **A4** | Dev stub, confirm mechanism at Phase 1B | Lowest | Acceptable ONLY if Phase 1A is explicitly not deployed to production |

### Decision B — API Path Routing

Choose one:

| Option | Description |
|---|---|
| **B1** | PodLever takes root `/`; api-server moved to `/legacy-api/` or disabled |
| **B2** | PodLever uses a dedicated path prefix for its Route Handlers (e.g., `/rpc/`) |
| **B3** | Keep api-server at `/api`; PodLever uses Next.js Server Actions only (no Route Handlers) |

### Decision C — Dev Identity Stubbing

- Is a hardcoded stub identity (`__STUB_OWNER_ID__`) acceptable for Phase 1A verification purposes?
- Should the stub be removed before marking Phase 1A complete, or is an explicit "stub accepted" ADR entry sufficient?

---

## 6. Files Created for T2

- `app/api/discovery/headers/route.ts` — diagnostic header inspection route (**removed — Task #5 audit**)
- `docs/discovery/t2-identity-findings.md` — this document

## 7. Task #5 Audit Results (2026-07-18)

All "remove before Phase 1B" items from this document have been resolved:

| Item | Status |
|---|---|
| `app/api/discovery/headers/route.ts` diagnostic route | ✅ Already removed — file does not exist |
| `__STUB_OWNER_ID__` hardcoded stub identity | ✅ Never merged — replaced by `getOwnerReplitUserId()` reading `OWNER_REPLIT_USER_ID` / `REPLIT_USERID` |
| `console.log` noise in auth routes | ✅ Not noise — structured SOC audit logs (`JSON.stringify`) intentionally retained |
| `page.tsx` stale "#3 Remove diagnostic endpoint" UI reference | ✅ Removed in Task #5 audit |

`grep -r "STUB\|__DEV\|TODO.*auth\|hardcoded" artifacts/podlever` — **zero actionable hits in production code paths.**
