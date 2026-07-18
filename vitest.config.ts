import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The DB-backed `*.pg.test.ts` suites share one Postgres test database and reset it in
    // beforeEach (TRUNCATE ... CASCADE). Running test FILES in parallel would let two such
    // suites truncate each other mid-run, producing flaky cross-file failures. Serialize file
    // execution so every shared-database suite owns the database for its whole run. The suite
    // is small and fast, so the wall-clock cost is negligible; correctness/determinism wins.
    fileParallelism: false,
  },
});
