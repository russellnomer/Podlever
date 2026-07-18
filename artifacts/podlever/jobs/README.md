# /jobs — Background Job Handlers (Phase 1B)

**Status: Structured placeholder — no workers in Phase 1A**

This directory is scaffolded in T1 per the architectural plan. No job implementations
exist in Phase 1A. The structure below is the target shape for Phase 1B.

## Phase 1B target structure

```
jobs/
├── README.md             ← this file
├── index.ts              ← job registry (export all named job handlers)
└── handlers/
    ├── process-audio.ts  ← triggered after upload; calls AssemblyAI
    ├── generate-clips.ts ← triggered after transcription complete
    └── publish-assets.ts ← triggered after all clips approved
```

## Rules (enforced from Phase 1B)

- Job handlers follow the same layering as Route Handlers:
  Job Handler → Service → Repository → Drizzle
- Job handlers NEVER import Repositories directly.
- Job handlers use caller-supplied idempotency keys when calling FSM transitions
  to prevent double-processing on retry.
- Recommended job runtime: Inngest or Upstash QStash (see Phase 1B plan).

## Phase 1A constraint

Zero code here in Phase 1A. Do not add workers, queues, or schedulers before
the Background Job infrastructure task in Phase 1B.
