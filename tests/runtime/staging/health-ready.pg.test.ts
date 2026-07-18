/**
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1) — readiness route over real Postgres.
 *
 * Exercises GET /api/health/ready end-to-end against GEO_TEST_DATABASE_URL (geoplane_pl_e):
 *   - 200 "ready" when every blocker check passes against a migrated database, and
 *   - 503 "not_ready" with a per-check breakdown when an injected dependency fails.
 * The route's dependencies are injected via __setReadyDependenciesForTests so the test controls
 * both the database handle and the resolved env. Skips cleanly when no test DB is configured.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import type { PreflightEnv } from "../../../src/runtime/observability/preflight.js";
import { __setReadyDependenciesForTests } from "../../../src/runtime/observability/readiness.js";
import { GET as readyRoute } from "../../../src/app/api/health/ready/route.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

const healthyEnv: PreflightEnv = {
  databaseUrl: testConfig?.connectionString ?? "postgresql://present",
  sessionSigningKeyCurrent: "a-sufficiently-long-signing-key-value",
  providerRuntimeEnabled: "false",
};

/** A DatabasePort whose every operation fails, standing in for an unreachable database. */
const brokenDb: DatabasePort = {
  async query(): Promise<never> {
    throw new Error("ECONNREFUSED");
  },
  async transaction(): Promise<never> {
    throw new Error("ECONNREFUSED");
  },
  async close(): Promise<void> {},
};

let db: DatabasePort;

describe.skipIf(testConfig === null)("GET /api/health/ready — real Postgres", () => {
  beforeAll(async () => {
    db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 4 });
    await applyMigrations(db, migrationsDir);
  });

  afterAll(async () => {
    __setReadyDependenciesForTests(null);
    if (db) await db.close();
  });

  it("returns 200 ready when all checks pass against a migrated database", async () => {
    __setReadyDependenciesForTests({ db, env: healthyEnv, prod: false });

    const res = await readyRoute();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ready");

    const byName = (name: string) =>
      body.checks.find((c: { name: string }) => c.name === name);
    expect(byName("database").status).toBe("PASS");
    expect(byName("migrations").status).toBe("PASS");
    expect(byName("migrations").detail).toContain("migrations applied");
    expect(byName("environment").status).toBe("PASS");
    expect(byName("file-storage").status).toBe("PASS");
    // Provider flag state is reported in the breakdown.
    expect(byName("provider-disabled")).toBeDefined();
  });

  it("returns 503 with a breakdown when the database is unreachable", async () => {
    __setReadyDependenciesForTests({ db: brokenDb, env: healthyEnv, prod: false });

    const res = await readyRoute();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("not_ready");
    const database = body.checks.find((c: { name: string }) => c.name === "database");
    expect(database.status).toBe("FAIL");
    expect(database.blocker).toBe(true);
  });

  it("returns 503 when a required env var is missing, even with a healthy DB", async () => {
    __setReadyDependenciesForTests({
      db,
      env: { ...healthyEnv, sessionSigningKeyCurrent: null },
      prod: false,
    });

    const res = await readyRoute();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("not_ready");
    expect(body.checks.find((c: { name: string }) => c.name === "environment").status).toBe("FAIL");
  });

  it("never leaks the database connection string in the body", async () => {
    __setReadyDependenciesForTests({ db, env: healthyEnv, prod: false });

    const res = await readyRoute();
    const raw = await res.text();
    expect(raw).not.toContain(testConfig!.connectionString);
    // A password-shaped secret must never appear either.
    expect(raw).not.toContain("signing-key-value");
  });
});
