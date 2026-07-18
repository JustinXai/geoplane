/**
 * ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1 — offline unit tests for
 * DatabaseEnvironmentPreflightV1's CLOSED error taxonomy.
 *
 * Every check is exercised with explicit inputs (fake/misconfigured URLs, stub Queryables, stub
 * connect factories), so nothing here touches process.env or a real database. The expected
 * migration floor is DERIVED from migrations/manifest.json via the same reader the check uses —
 * no version is hardcoded, so these tests stay correct when 0008+ land.
 */
import { describe, expect, it } from "vitest";
import type { DbQueryResult, Queryable, SqlParam } from "../../../src/persistence/database-port.js";
import {
  highestRequiredMigrationVersion,
  requiredMigrationVersions,
} from "../../../src/persistence/migration-manifest.js";
import {
  checkDatabasePurpose,
  checkMigrationLedger,
  checkRolePrivileges,
  classifyConnectionError,
  describeDatabaseUrl,
  runDatabaseEnvironmentPreflight,
  sameDatabaseTarget,
  type DatabaseConnectFn,
  type DatabaseRoleReport,
} from "../../../src/runtime/observability/database-environment-preflight.js";

// --- helpers ----------------------------------------------------------------
// All fixture URLs carry only the placeholder credential change_me — never a real value.

const RUNTIME_URL = "postgresql://geoplane_app:change_me@localhost:5432/geoplane_runtime";
const TEST_URL = "postgresql://geoplane_app:change_me@localhost:5432/geoplane_runtime_test";
const CANARY_URL = "postgresql://geoplane_app:change_me@localhost:5432/geoplane_canary";

function shapeOf(url: string) {
  const s = describeDatabaseUrl(url);
  if (!s) throw new Error("fixture URL must parse");
  return s;
}

function stubDb(handler: (sql: string) => DbQueryResult<Record<string, unknown>>): Queryable {
  return {
    async query<T = Record<string, unknown>>(
      sql: string,
      _params?: readonly SqlParam[],
    ): Promise<DbQueryResult<T>> {
      return handler(sql) as unknown as DbQueryResult<T>;
    },
  };
}

/** A healthy connected database: non-superuser role, TRUNCATE granted, ledger at manifest floor. */
const healthyDb = stubDb((sql) => {
  if (sql.includes("pg_roles")) return { rows: [{ is_super: false }], rowCount: 1 };
  if (sql.includes("has_table_privilege")) {
    return { rows: [{ present: true, can_truncate: true }], rowCount: 1 };
  }
  if (sql.includes("schema_migrations")) {
    const versions = requiredMigrationVersions();
    return { rows: versions.map((v) => ({ filename: `${v}_x.sql` })), rowCount: versions.length };
  }
  return { rows: [], rowCount: 0 };
});

const healthyConnect: DatabaseConnectFn = async () => ({
  db: healthyDb,
  close: async () => undefined,
});

function pgError(code: string, message = "server error"): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function codes(report: DatabaseRoleReport): string[] {
  return report.errors.map((e) => e.code);
}

// --- describeDatabaseUrl ----------------------------------------------------

describe("describeDatabaseUrl", () => {
  it("projects a postgres URL to its secret-free shape (no password field exists)", () => {
    const shape = shapeOf(TEST_URL);
    expect(shape).toEqual({
      host: "localhost",
      port: "5432",
      dbName: "geoplane_runtime_test",
      user: "geoplane_app",
    });
    expect(JSON.stringify(shape)).not.toContain("change_me");
  });

  it("defaults the port to 5432 and accepts the postgres:// scheme", () => {
    expect(shapeOf("postgres://u:change_me@db.example.internal/geoplane_canary")).toEqual({
      host: "db.example.internal",
      port: "5432",
      dbName: "geoplane_canary",
      user: "u",
    });
  });

  it("returns null for unparseable, non-postgres, or database-less URLs", () => {
    expect(describeDatabaseUrl("not a url")).toBeNull();
    expect(describeDatabaseUrl("mysql://u:change_me@localhost:3306/geo")).toBeNull();
    expect(describeDatabaseUrl("postgresql://u:change_me@localhost:5432/")).toBeNull();
  });
});

// --- purpose rules (DATABASE_PURPOSE_MISMATCH) ------------------------------

describe("checkDatabasePurpose", () => {
  const runtime = shapeOf(RUNTIME_URL);
  const test = shapeOf(TEST_URL);
  const canary = shapeOf(CANARY_URL);

  it("passes the correctly-named trio", () => {
    expect(checkDatabasePurpose("runtime", runtime, { runtime, test })).toEqual([]);
    expect(checkDatabasePurpose("test", test, { runtime, test })).toEqual([]);
    expect(checkDatabasePurpose("canary", canary, { runtime, test })).toEqual([]);
  });

  it("rejects a test database whose name does not contain 'test'", () => {
    const notTest = shapeOf("postgresql://u:change_me@localhost:5432/geoplane_prod_copy");
    const errors = checkDatabasePurpose("test", notTest, { runtime, test: notTest });
    expect(errors.map((e) => e.code)).toEqual(["DATABASE_PURPOSE_MISMATCH"]);
  });

  it("rejects a canary database whose name does not contain 'canary'", () => {
    const misnamed = shapeOf("postgresql://u:change_me@localhost:5432/geoplane_scratch");
    const errors = checkDatabasePurpose("canary", misnamed, { runtime, test });
    expect(errors.map((e) => e.code)).toEqual(["DATABASE_PURPOSE_MISMATCH"]);
  });

  it("rejects a canary URL that points at the RUNTIME database (host+port+dbname)", () => {
    const errors = checkDatabasePurpose("canary", runtime, { runtime, test });
    expect(errors.map((e) => e.code)).toContain("DATABASE_PURPOSE_MISMATCH");
    expect(errors.some((e) => e.detail.includes("RUNTIME"))).toBe(true);
  });

  it("rejects a canary URL that points at the TEST database", () => {
    // Name contains 'canary'? No — it IS the test shape; both the naming and target rules fire.
    const errors = checkDatabasePurpose("canary", test, { runtime, test });
    expect(errors.every((e) => e.code === "DATABASE_PURPOSE_MISMATCH")).toBe(true);
    expect(errors.some((e) => e.detail.includes("TEST"))).toBe(true);
  });

  it("accepts a canary on the same server but a different database, rejects same-name-different-port as distinct", () => {
    const otherPort = shapeOf("postgresql://u:change_me@localhost:5433/geoplane_runtime");
    expect(sameDatabaseTarget(otherPort, runtime)).toBe(false);
    expect(sameDatabaseTarget(shapeOf(RUNTIME_URL), runtime)).toBe(true);
  });

  it("rejects a runtime database whose name looks like a test/canary database", () => {
    for (const bad of [test, canary]) {
      const errors = checkDatabasePurpose("runtime", bad, { runtime: bad, test });
      expect(errors.map((e) => e.code)).toEqual(["DATABASE_PURPOSE_MISMATCH"]);
    }
  });
});

// --- connection-error classification ----------------------------------------

describe("classifyConnectionError", () => {
  it("maps SQLSTATE 28P01/28000 (rejected credential) to DATABASE_AUTH_FAILED", () => {
    expect(classifyConnectionError(pgError("28P01")).code).toBe("DATABASE_AUTH_FAILED");
    expect(classifyConnectionError(pgError("28000")).code).toBe("DATABASE_AUTH_FAILED");
  });

  it("maps driver-level password/SASL failures without a SQLSTATE to DATABASE_AUTH_FAILED", () => {
    expect(classifyConnectionError(new Error("SASL: client password must be a string")).code).toBe(
      "DATABASE_AUTH_FAILED",
    );
  });

  it("maps SQLSTATE 42501 (connect permission denied) to DATABASE_ROLE_INVALID", () => {
    expect(classifyConnectionError(pgError("42501")).code).toBe("DATABASE_ROLE_INVALID");
  });

  it("maps network failures and a missing database to DATABASE_UNREACHABLE", () => {
    expect(classifyConnectionError(pgError("ECONNREFUSED", "connect ECONNREFUSED")).code).toBe(
      "DATABASE_UNREACHABLE",
    );
    expect(classifyConnectionError(pgError("ETIMEDOUT", "timeout")).code).toBe("DATABASE_UNREACHABLE");
    expect(classifyConnectionError(pgError("3D000", "database does not exist")).code).toBe(
      "DATABASE_UNREACHABLE",
    );
    expect(classifyConnectionError(new Error("something else")).code).toBe("DATABASE_UNREACHABLE");
  });

  it("never echoes the thrown message into the detail (secret-free by construction)", () => {
    const result = classifyConnectionError(pgError("28P01", "password for something was wrong"));
    expect(result.detail).not.toContain("something");
  });
});

// --- connected role-privilege checks ----------------------------------------

describe("checkRolePrivileges", () => {
  it("passes a least-privilege role with TRUNCATE on the test database", async () => {
    expect(await checkRolePrivileges(healthyDb, "test")).toEqual([]);
    expect(await checkRolePrivileges(healthyDb, "runtime")).toEqual([]);
    expect(await checkRolePrivileges(healthyDb, "canary")).toEqual([]);
  });

  it("flags a SUPERUSER connection as DATABASE_ROLE_INVALID", async () => {
    const superDb = stubDb((sql) => {
      if (sql.includes("pg_roles")) return { rows: [{ is_super: true }], rowCount: 1 };
      if (sql.includes("has_table_privilege")) {
        return { rows: [{ present: true, can_truncate: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const errors = await checkRolePrivileges(superDb, "runtime");
    expect(errors.map((e) => e.code)).toEqual(["DATABASE_ROLE_INVALID"]);
  });

  it("flags a test-database role that cannot TRUNCATE as DATABASE_ROLE_INVALID", async () => {
    const noTruncate = stubDb((sql) => {
      if (sql.includes("pg_roles")) return { rows: [{ is_super: false }], rowCount: 1 };
      if (sql.includes("has_table_privilege")) {
        return { rows: [{ present: true, can_truncate: false }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    expect((await checkRolePrivileges(noTruncate, "test")).map((e) => e.code)).toEqual([
      "DATABASE_ROLE_INVALID",
    ]);
    // The same missing privilege on the runtime/canary roles is NOT flagged (they never TRUNCATE).
    expect(await checkRolePrivileges(noTruncate, "runtime")).toEqual([]);
    expect(await checkRolePrivileges(noTruncate, "canary")).toEqual([]);
  });

  it("does not flag TRUNCATE when application tables are not yet migrated (migration check owns that)", async () => {
    const empty = stubDb((sql) => {
      if (sql.includes("pg_roles")) return { rows: [{ is_super: false }], rowCount: 1 };
      if (sql.includes("has_table_privilege")) {
        return { rows: [{ present: false, can_truncate: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    expect(await checkRolePrivileges(empty, "test")).toEqual([]);
  });
});

// --- migration-ledger consistency (derived from the manifest) ----------------

describe("checkMigrationLedger", () => {
  it("passes when every manifest-required version is applied", async () => {
    expect(await checkMigrationLedger(healthyDb)).toEqual([]);
  });

  it("passes when the database is AHEAD of the build (floor semantics)", async () => {
    const ahead = stubDb((sql) => {
      if (sql.includes("schema_migrations")) {
        const versions = [...requiredMigrationVersions(), "9999"];
        return { rows: versions.map((v) => ({ filename: `${v}_x.sql` })), rowCount: versions.length };
      }
      return { rows: [], rowCount: 0 };
    });
    expect(await checkMigrationLedger(ahead)).toEqual([]);
  });

  it("flags a ledger stuck at 0001 as DATABASE_MIGRATION_BEHIND, naming the manifest floor", async () => {
    const behind = stubDb((sql) => {
      if (sql.includes("schema_migrations")) return { rows: [{ filename: "0001_x.sql" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const errors = await checkMigrationLedger(behind);
    expect(errors.map((e) => e.code)).toEqual(["DATABASE_MIGRATION_BEHIND"]);
    // The floor is DERIVED from migrations/manifest.json — when 0008 lands this expectation follows it.
    expect(errors[0]!.detail).toContain(highestRequiredMigrationVersion());
  });

  it("flags a database with NO schema_migrations table (42P01) as DATABASE_MIGRATION_BEHIND", async () => {
    const noLedger: Queryable = {
      async query(): Promise<never> {
        throw pgError("42P01", 'relation "schema_migrations" does not exist');
      },
    };
    expect((await checkMigrationLedger(noLedger)).map((e) => e.code)).toEqual([
      "DATABASE_MIGRATION_BEHIND",
    ]);
  });

  it("propagates non-42P01 failures for connection-taxonomy classification", async () => {
    const authFailing: Queryable = {
      async query(): Promise<never> {
        throw pgError("28P01", "auth failed");
      },
    };
    await expect(checkMigrationLedger(authFailing)).rejects.toMatchObject({ code: "28P01" });
  });
});

// --- orchestration -----------------------------------------------------------

describe("runDatabaseEnvironmentPreflight", () => {
  const HEALTHY_URLS = { runtime: RUNTIME_URL, test: TEST_URL, canary: CANARY_URL };

  it("PASSes all three roles for a correctly configured environment", async () => {
    const report = await runDatabaseEnvironmentPreflight(HEALTHY_URLS, healthyConnect);
    expect(report.ok).toBe(true);
    expect(report.roles.map((r) => [r.role, r.status])).toEqual([
      ["runtime", "PASS"],
      ["test", "PASS"],
      ["canary", "PASS"],
    ]);
    expect(report.roles.map((r) => r.envVar)).toEqual([
      "GEO_DATABASE_URL",
      "GEO_TEST_DATABASE_URL",
      "GEO_CANARY_DATABASE_URL",
    ]);
  });

  it("reports DATABASE_URL_MISSING per absent role without attempting a connection", async () => {
    const neverConnect: DatabaseConnectFn = async () => {
      throw new Error("must not be called");
    };
    const report = await runDatabaseEnvironmentPreflight(
      { runtime: null, test: null, canary: null },
      neverConnect,
    );
    expect(report.ok).toBe(false);
    for (const role of report.roles) {
      expect(codes(role)).toEqual(["DATABASE_URL_MISSING"]);
    }
  });

  it("classifies a rejected credential as DATABASE_AUTH_FAILED for exactly the failing role", async () => {
    const connect: DatabaseConnectFn = async (url) => {
      if (url.includes("geoplane_runtime_test")) throw pgError("28P01", "auth failed");
      return healthyConnect(url);
    };
    const report = await runDatabaseEnvironmentPreflight(HEALTHY_URLS, connect);
    expect(report.ok).toBe(false);
    const byRole = Object.fromEntries(report.roles.map((r) => [r.role, r]));
    expect(byRole.runtime!.status).toBe("PASS");
    expect(codes(byRole.test!)).toEqual(["DATABASE_AUTH_FAILED"]);
    expect(byRole.canary!.status).toBe("PASS");
  });

  it("classifies an unanswering server as DATABASE_UNREACHABLE and a malformed URL likewise", async () => {
    const refused: DatabaseConnectFn = async () => {
      throw pgError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432");
    };
    const down = await runDatabaseEnvironmentPreflight(HEALTHY_URLS, refused);
    expect(down.ok).toBe(false);
    for (const role of down.roles) expect(codes(role)).toEqual(["DATABASE_UNREACHABLE"]);

    const malformed = await runDatabaseEnvironmentPreflight(
      { ...HEALTHY_URLS, canary: "not-a-url" },
      healthyConnect,
    );
    const canary = malformed.roles.find((r) => r.role === "canary")!;
    expect(codes(canary)).toEqual(["DATABASE_UNREACHABLE"]);
    expect(canary.dbName).toBeNull();
  });

  it("flags a canary URL aimed at the runtime database as DATABASE_PURPOSE_MISMATCH (and still connects nowhere unsafe)", async () => {
    const report = await runDatabaseEnvironmentPreflight(
      { ...HEALTHY_URLS, canary: RUNTIME_URL },
      healthyConnect,
    );
    expect(report.ok).toBe(false);
    const canary = report.roles.find((r) => r.role === "canary")!;
    expect(codes(canary)).toContain("DATABASE_PURPOSE_MISMATCH");
  });

  it("flags a migration-behind database on the affected role only", async () => {
    const behindDb = stubDb((sql) => {
      if (sql.includes("pg_roles")) return { rows: [{ is_super: false }], rowCount: 1 };
      if (sql.includes("has_table_privilege")) {
        return { rows: [{ present: true, can_truncate: true }], rowCount: 1 };
      }
      if (sql.includes("schema_migrations")) return { rows: [{ filename: "0001_x.sql" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const connect: DatabaseConnectFn = async (url) =>
      url.includes("geoplane_canary")
        ? { db: behindDb, close: async () => undefined }
        : healthyConnect(url);
    const report = await runDatabaseEnvironmentPreflight(HEALTHY_URLS, connect);
    expect(report.ok).toBe(false);
    const byRole = Object.fromEntries(report.roles.map((r) => [r.role, r]));
    expect(byRole.runtime!.status).toBe("PASS");
    expect(byRole.test!.status).toBe("PASS");
    expect(codes(byRole.canary!)).toEqual(["DATABASE_MIGRATION_BEHIND"]);
  });

  it("always closes injected connections, even when a connected check fails", async () => {
    let closed = 0;
    const connect: DatabaseConnectFn = async () => ({
      db: {
        async query(): Promise<never> {
          throw pgError("42501", "permission denied");
        },
      },
      close: async () => {
        closed += 1;
      },
    });
    const report = await runDatabaseEnvironmentPreflight(HEALTHY_URLS, connect);
    expect(closed).toBe(3);
    for (const role of report.roles) expect(codes(role)).toEqual(["DATABASE_ROLE_INVALID"]);
  });

  it("never leaks a credential into any report field", async () => {
    const report = await runDatabaseEnvironmentPreflight(HEALTHY_URLS, healthyConnect);
    expect(JSON.stringify(report)).not.toContain("change_me");
  });
});
