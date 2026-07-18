# /config — Typed Configuration Module (T4)

**Status: Placeholder — implemented in T4**

This directory will contain the Zod-validated environment configuration module.

## What goes here (T4)

- `index.ts` — Parses and validates all `process.env` variables at startup using Zod.
  Exports a typed `config` object consumed by every other module.
- `.env.example` additions — Every new env var must be documented in `/.env.example`.

## Rules

- **No module may read `process.env` directly** outside of this directory.
- If a required variable is missing or invalid, the process must throw at startup with a clear error.
- All variables must have an entry in `.env.example` with a comment explaining what they control.
