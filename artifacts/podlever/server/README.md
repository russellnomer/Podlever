# /server — Server-side Domain Modules (T9)

**Status: Placeholder — Episode FSM implemented in T9**

This directory contains server-only domain logic that is too complex for the service layer
but does not belong in repositories. The Episode FSM lives here.

## What goes here

- `fsm/` — Episode Finite State Machine: state types, transition map, transition executor.
  The FSM calls into EpisodeRepository via an injected service/repo handle — it never
  imports Drizzle or pg directly.

## Rules

- All code here is `server-only` (add `import "server-only"` at the top of each file).
- No direct Drizzle imports — use repository method signatures.
- FSM state vocabulary is defined here and imported by `/types` schemas.
