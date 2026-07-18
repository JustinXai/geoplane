/**
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1) — unit tests for the deployment preflight checks.
 *
 * Each check is exercised in both its passing and failing shape using explicit inputs (a resolved
 * PreflightEnv literal and a stub Queryable), so nothing here touches process.env or a real DB.
 */
import { describe, expect, it } from "vitest";
import type { DbQueryResult, Queryable, SqlParam } from "../../../src/persistence/database-port.js";
import {
  CURRENT_MIGRATION_VERSION,
  EXPECTED_MIGRATION_VERSIONS,
  checkDatabaseConnection,
  checkEnvironment,
  checkFileStorage,
  checkMigrations,
  checkProviderDisabled,
  checkSessionKey,
  runPreflightChecks,
  summarize,
  versionPrefix,
  type PreflightCheckResult,
  type PreflightEnv,
} from "../../../src/runtime/observability/preflight.js";

// --- helpers ----------------------------------------------------------------

const HEALTHY_ENV: PreflightEnv = {
  databaseUrl: "postgresql://user:pw@localhost:5432/db",
  sessionSigningKeyCurrent: "a-sufficiently-long-signing-key-value",
  providerRuntimeEnabled: "false",
};

/** A Queryable whose behaviour is driven by a handler keyed on the SQL text. */
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

const throwingDb: Queryable = {
  async query(): Promise<never> {
    throw new Error("connection refused");
  },
};

// Derives the applied set from the SAME dynamic expected list the check reads, so it stays
// correct as migrations are added (0006, 0007, …) — no hardcoded version list to go stale.
const allMigrationsApplied = stubDb((sql) => {
  if (sql.includes("schema_migrations")) {
    return {
      rows: EXPECTED_MIGRATION_VERSIONS.map((v) => ({ filename: `${v}_x.sql` })),
      rowCount: EXPECTED_MIGRATION_VERSIONS.length,
    };
  }
  if (sql.includes("SELECT 1")) return { rows: [{ ok: 1 }], rowCount: 1 };
  return { rows: [], rowCount: 0 }; // knowledge_content probe
});

function byName(checks: readonly PreflightCheckResult[], name: string): PreflightCheckResult {
  const found = checks.find((c) => c.name === name);
  if (!found) throw new Error(`no check named ${name}`);
  return found;
}

// --- environment ------------------------------------------------------------

describe("checkEnvironment", () => {
  it("PASSes when the DB url and signing key are present", () => {
    const r = checkEnvironment(HEALTHY_ENV);
    expect(r.status).toBe("PASS");
    expect(r.blocker).toBe(true);
  });

  it("FAILs and lists every missing var", () => {
    const r = checkEnvironment({
      databaseUrl: null,
      sessionSigningKeyCurrent: null,
      providerRuntimeEnabled: null,
    });
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("GEO_DATABASE_URL");
    expect(r.detail).toContain("SESSION_SIGNING_KEY_CURRENT");
  });
});

// --- session key ------------------------------------------------------------

describe("checkSessionKey", () => {
  it("PASSes with a strong key", () => {
    expect(checkSessionKey(HEALTHY_ENV, { prod: true }).status).toBe("PASS");
  });

  it("FAILs when missing", () => {
    const r = checkSessionKey({ ...HEALTHY_ENV, sessionSigningKeyCurrent: null }, { prod: false });
    expect(r.status).toBe("FAIL");
  });

  it("WARNs on a dev placeholder outside production", () => {
    const r = checkSessionKey({ ...HEALTHY_ENV, sessionSigningKeyCurrent: "change_me" }, { prod: false });
    expect(r.status).toBe("WARN");
  });

  it("FAILs on a dev placeholder in a production run", () => {
    const r = checkSessionKey({ ...HEALTHY_ENV, sessionSigningKeyCurrent: "change_me" }, { prod: true });
    expect(r.status).toBe("FAIL");
  });

  it("FAILs on a too-short key in a production run", () => {
    const r = checkSessionKey({ ...HEALTHY_ENV, sessionSigningKeyCurrent: "short" }, { prod: true });
    expect(r.status).toBe("FAIL");
  });

  it("never echoes the key material in its detail", () => {
    const secret = "a-sufficiently-long-signing-key-value";
    const r = checkSessionKey({ ...HEALTHY_ENV, sessionSigningKeyCurrent: secret }, { prod: false });
    expect(r.detail).not.toContain(secret);
  });
});

// --- provider disabled ------------------------------------------------------

describe("checkProviderDisabled", () => {
  it("PASSes when the flag is false", () => {
    expect(checkProviderDisabled({ ...HEALTHY_ENV, providerRuntimeEnabled: "false" }).status).toBe("PASS");
  });

  it("PASSes when the flag is absent", () => {
    expect(checkProviderDisabled({ ...HEALTHY_ENV, providerRuntimeEnabled: null }).status).toBe("PASS");
  });

  it("WARNs (never blocks) when the flag is true", () => {
    const r = checkProviderDisabled({ ...HEALTHY_ENV, providerRuntimeEnabled: "true" });
    expect(r.status).toBe("WARN");
    expect(r.blocker).toBe(false);
  });
});

// --- database ---------------------------------------------------------------

describe("checkDatabaseConnection", () => {
  it("PASSes on SELECT 1 = 1", async () => {
    const db = stubDb(() => ({ rows: [{ ok: 1 }], rowCount: 1 }));
    expect((await checkDatabaseConnection(db)).status).toBe("PASS");
  });

  it("FAILs when the connection throws", async () => {
    expect((await checkDatabaseConnection(throwingDb)).status).toBe("FAIL");
  });

  it("FAILs when db is null", async () => {
    expect((await checkDatabaseConnection(null)).status).toBe("FAIL");
  });
});

// --- migrations -------------------------------------------------------------

describe("checkMigrations", () => {
  it("PASSes when all expected versions are applied", async () => {
    const r = await checkMigrations(allMigrationsApplied);
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain(CURRENT_MIGRATION_VERSION);
  });

  it("FAILs and reports the missing version", async () => {
    const missingSix = stubDb(() => ({
      rows: ["0001_a.sql", "0002_b.sql", "0003_c.sql", "0004_d.sql", "0005_e.sql"].map((filename) => ({
        filename,
      })),
      rowCount: 5,
    }));
    const r = await checkMigrations(missingSix);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("0006");
  });

  it("FAILs when the ledger query throws", async () => {
    expect((await checkMigrations(throwingDb)).status).toBe("FAIL");
  });
});

// --- file storage -----------------------------------------------------------

describe("checkFileStorage", () => {
  it("PASSes when the knowledge_content probe answers", async () => {
    const db = stubDb(() => ({ rows: [], rowCount: 0 }));
    expect((await checkFileStorage(db)).status).toBe("PASS");
  });

  it("FAILs when the probe throws", async () => {
    expect((await checkFileStorage(throwingDb)).status).toBe("FAIL");
  });
});

// --- summarize + orchestration ---------------------------------------------

describe("summarize", () => {
  it("is ok when no blocker FAILed, even with warnings", () => {
    const checks: PreflightCheckResult[] = [
      { name: "a", status: "PASS", blocker: true, detail: "" },
      { name: "b", status: "WARN", blocker: false, detail: "" },
    ];
    const report = summarize(checks);
    expect(report.ok).toBe(true);
    expect(report.hasWarnings).toBe(true);
  });

  it("is not ok when a blocker FAILed", () => {
    const checks: PreflightCheckResult[] = [
      { name: "a", status: "FAIL", blocker: true, detail: "" },
    ];
    expect(summarize(checks).ok).toBe(false);
  });
});

describe("runPreflightChecks", () => {
  it("returns all six checks green for a healthy environment", async () => {
    const checks = await runPreflightChecks({ env: HEALTHY_ENV, db: allMigrationsApplied, prod: false });
    expect(checks).toHaveLength(6);
    expect(summarize(checks).ok).toBe(true);
    expect(byName(checks, "database").status).toBe("PASS");
    expect(byName(checks, "migrations").status).toBe("PASS");
    expect(byName(checks, "file-storage").status).toBe("PASS");
    expect(byName(checks, "provider-disabled").status).toBe("PASS");
  });

  it("is not ok when the database is unreachable", async () => {
    const checks = await runPreflightChecks({ env: HEALTHY_ENV, db: throwingDb, prod: false });
    expect(summarize(checks).ok).toBe(false);
    expect(byName(checks, "database").status).toBe("FAIL");
  });
});

describe("versionPrefix", () => {
  it("extracts the leading four digits", () => {
    expect(versionPrefix("0006_knowledge_content.sql")).toBe("0006");
    expect(versionPrefix("no-version.sql")).toBeNull();
  });
});
