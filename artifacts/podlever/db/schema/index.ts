/**
 * db/schema/index.ts — Barrel export for all PodLever Drizzle table definitions
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: all schema modules in this directory
 *
 * HUMAN REVIEW NOTES:
 * Import order matters for drizzle-kit migration generation:
 * referenced tables (users, episodes) must be exported before dependent tables
 * (episodes references users; assets and pipeline_events reference episodes).
 * Drizzle resolves FK references by declaration order in this barrel.
 *
 * When adding new tables in Phase 1B+:
 * 1. Create the file in /db/schema/
 * 2. Export it here
 * 3. Run: pnpm --filter @workspace/podlever run db:generate
 * 4. Run: pnpm --filter @workspace/podlever run db:migrate (never db:push in production)
 */

// Foundation entities (no inbound FK dependencies)
export * from "./users";

// Core domain entities (depend on users)
export * from "./episodes";

// Asset entities (depend on episodes)
export * from "./assets";

// Audit/event log (depends on episodes; append-only)
export * from "./pipeline-events";
