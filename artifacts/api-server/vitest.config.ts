import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Match the workspace TS resolution so `@workspace/*` packages resolve to
    // their source entry points (mirrors tsconfig.base.json customConditions).
    conditions: ["workspace"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // These tests talk to the real dev Postgres, so give hooks/tests headroom.
    hookTimeout: 30000,
    testTimeout: 30000,
    // Route handlers share a single global `db` pool; run files serially so
    // snapshot/restore of the shared tables can't interleave.
    fileParallelism: false,
  },
});
