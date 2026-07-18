# /lib — Shared Utilities

**Status: Active — `utils.ts` (shadcn/ui helper) is here from T1**

General-purpose helpers used across the application. No business logic lives here.

## What belongs here

- `utils.ts` — `cn()` class-name helper (already created in T1)
- Future: date formatting, string helpers, error type guards

## Rules

- No database imports in `/lib`.
- No server-only code in `/lib` unless the file is explicitly marked `server-only`.
- No business logic — pure utility functions only.
