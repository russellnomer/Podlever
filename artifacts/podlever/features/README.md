# /features — Feature Modules (Phase 1B+)

**Status: Placeholder — empty in Phase 1A**

Feature modules group UI components, hooks, and client-side logic by product domain
(e.g., `/features/episode`, `/features/asset`). They sit above the component layer
and below the service layer in the dependency hierarchy.

## Rules

- Feature modules may import from `/components`, `/lib`, and `/types`.
- Feature modules may NOT import from `/services`, `/repositories`, or `/db` directly.
- All data fetching in feature modules goes through Server Actions or Route Handlers.
- Route Handlers called from feature modules must use the `/rpc/` prefix (never `/api/`).
  See `app/api/README.md` and `docs/adr/0001-architecture.md` § "Proxy Routing Conflict".
