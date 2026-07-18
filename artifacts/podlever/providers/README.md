# /providers — Provider Abstractions (T6)

**Status: Placeholder — implemented in T6 (after T3 Human Checkpoint)**

⚠️  BLOCKED: T6 cannot start until T3 (Human Checkpoint) clears.
T3 requires T2 (Environment Discovery) findings to be reviewed by Russell.

## What goes here (T6)

- `auth/index.ts` — AuthProvider interface and concrete implementation.
  The interface is narrow:
    - `getCurrentIdentity(req): Promise<Identity | null>`
    - `getSession(req): Promise<Session | null>`
    - `requireOwner(req): Promise<Identity>` (throws if not owner)
  The concrete implementation wraps whichever mechanism T3 confirms.

## Rules

- Middleware imports from this provider to read identity. **Zero DB operations in middleware.**
- User upsert/sync NEVER occurs during RSC render. It happens only in Route Handler
  auth callbacks or first-interaction Server Actions.
- This is the ONLY auth surface downstream code touches — no direct header reads,
  no raw JWT parsing outside this directory.
