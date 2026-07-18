# /scripts — Verification and Utility Scripts (T11)

**Status: Placeholder — verify-fsm.ts added in T11**

Run scripts via: `pnpm --filter @workspace/podlever run verify-fsm`
(or `tsx scripts/verify-fsm.ts` from the artifact root)

## Planned scripts

### verify-fsm.ts (T11)
Verifies all four required FSM behaviors end-to-end against the real database:

1. **Valid transition** — creates a User + Episode, performs a valid state transition;
   asserts: state updated, `fsm_version` incremented, exactly one PipelineEvent inserted.

2. **Invalid transition** — attempts an illegal state jump (e.g., draft → published directly);
   asserts: typed `InvalidTransitionError` thrown, no DB writes, version unchanged.

3. **Stale version conflict** — simulates a concurrent write by bumping `fsm_version` out-of-band,
   then attempts a transition; asserts: typed `OptimisticLockError`, no partial writes.

4. **Idempotent replay** — replays a transition with the same `idempotency_key`;
   asserts: no new PipelineEvent, final state unchanged, no error thrown (no-op success).

**Exit codes:** 0 on all assertions passing; non-zero on any failure.
**Clean exit:** explicitly closes the DB connection — process must not hang.
