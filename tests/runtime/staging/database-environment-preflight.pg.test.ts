/**
 * ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1 — live verification that the locally reconciled
 * environment passes DatabaseEnvironmentPreflightV1 for all THREE roles.
 *
 * Skips cleanly when any of the three role URLs is unset (an environment without a reconciled
 * .env.local, e.g. CI without Postgres). Reads connection strings only through
 * loadDatabaseConfigForRole and NEVER prints one — assertions surface role/status/error CODES only.
 */
import { afterAll, describe, expect, it } from "vitest";
import { loadDatabaseConfigForRole } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import {
  runDatabaseEnvironmentPreflight,
  type DatabaseConnectFn,
} from "../../../src/runtime/observability/database-environment-preflight.js";

const urls = {
  runtime: loadDatabaseConfigForRole("runtime")?.connectionString ?? null,
  test: loadDatabaseConfigForRole("test")?.connectionString ?? null,
  canary: loadDatabaseConfigForRole("canary")?.connectionString ?? null,
};
const configured = urls.runtime !== null && urls.test !== null && urls.canary !== null;

const opened: DatabasePort[] = [];
const connect: DatabaseConnectFn = async (connectionString) => {
  const db = createPgDatabase({ connectionString, max: 1 });
  opened.push(db);
  // Force the lazy pool to actually connect so auth/network failures surface here.
  await db.query("SELECT 1");
  return { db, close: () => db.close() };
};

describe.skipIf(!configured)("DatabaseEnvironmentPreflightV1 against the reconciled local environment", () => {
  afterAll(async () => {
    await Promise.all(opened.map((db) => db.close().catch(() => undefined)));
  });

  it("PASSes the runtime, test and canary roles end-to-end", async () => {
    const report = await runDatabaseEnvironmentPreflight(urls, connect);
    // Secret-free debugging surface: role/status/error codes only.
    const summary = report.roles.map((r) => ({
      role: r.role,
      status: r.status,
      codes: r.errors.map((e) => e.code),
    }));
    expect(summary).toEqual([
      { role: "runtime", status: "PASS", codes: [] },
      { role: "test", status: "PASS", codes: [] },
      { role: "canary", status: "PASS", codes: [] },
    ]);
    expect(report.ok).toBe(true);
  });

  it("distinguishes the three databases by name (test contains 'test', canary contains 'canary', all distinct)", async () => {
    const report = await runDatabaseEnvironmentPreflight(urls, connect);
    const names = report.roles.map((r) => r.dbName);
    expect(new Set(names).size).toBe(3);
    expect(names[1]).toMatch(/test/i);
    expect(names[2]).toMatch(/canary/i);
  });
});
