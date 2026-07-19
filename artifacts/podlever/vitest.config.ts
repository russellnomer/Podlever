/**
 * vitest.config.ts — Vitest configuration for PodLever integration tests
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #45 — rate-limit persistence test)
 *
 * Resolves the `@` path alias (same as tsconfig.json paths) so test files
 * can import `@/lib/...` identically to how production code does.
 *
 * Test environment: node (no DOM needed for integration tests).
 * Timeout: 30 s per test — DB round-trips under load can be slow.
 */

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    testTimeout: 30_000,
    // Only run files in the __tests__ directory to avoid picking up Next.js pages
    include: ["__tests__/**/*.test.ts"],
    // Treat each test file as isolated so module-level singletons don't bleed
    pool: "forks",
  },
});
