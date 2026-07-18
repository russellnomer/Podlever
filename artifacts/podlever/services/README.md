# /services — Service Layer (T8)

**Status: Placeholder — implemented in T8**

Services orchestrate validation, authorization, and transactions. They sit between
Route Handlers / Server Actions and Repositories.

## What goes here (T8)

- `episode.service.ts` — EpisodeService: create, get, transition state, list
- `asset.service.ts` — AssetService: create version, get, list

## Layering Rules (MANDATORY)

```
Server Action / Route Handler / Job
        ↓
    Service  ← you are here
        ↓
   Repository
        ↓
     Drizzle
```

- Services own ALL domain invariants and authorization checks.
- Services call Repositories; Repositories call Drizzle.
- Route Handlers / Server Actions NEVER import Repositories directly.
- Verify with: `grep -r "from.*repositories" app/ --include="*.ts"` (should return nothing)
