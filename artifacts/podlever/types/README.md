# /types — Zod Schemas and Inferred TypeScript Types (T5, T9)

**Status: Placeholder — schemas added in T5 and T9**

This is the single source of Zod schemas for every domain entity. Server Actions,
Route Handlers, and Jobs all import and parse using the schemas defined here —
no per-entry-point schema duplication.

## What goes here

- `episode.ts` — Episode Zod schemas (state enum, create input, update input) + inferred types
- `asset.ts` — Asset schemas (asset_type enum, version schema) + inferred types
- `pipeline-event.ts` — PipelineEvent schemas + inferred types
- `user.ts` — User schemas (role enum, identity schema) + inferred types
- `common.ts` — Shared types (UUID, timestamps, pagination)

## Pattern (per entity)

```typescript
// episode.ts
import { z } from "zod";

// Schema (validation)
export const EpisodeStateSchema = z.enum(["draft", "processing", "published", "archived"]);
export const CreateEpisodeSchema = z.object({ title: z.string().min(1).max(255) });

// Types (inferred — single source of truth)
export type EpisodeState = z.infer<typeof EpisodeStateSchema>;
export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;
```

## Rules

- Every `z.infer<>` type is defined HERE and imported everywhere else.
- No raw TypeScript interfaces duplicating what a Zod schema already defines.
- No Drizzle imports in `/types` — schema ↔ db mapping belongs in `/db`.
