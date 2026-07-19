import { describe, expect, it } from "vitest";
import {
  assertSafeLocalTestDatabaseUrl,
  loadDatabaseConfig,
  loadDatabaseConfigForRole,
} from "../../src/persistence/config.js";

function localUrl(database: string, host = "127.0.0.1"): string {
  return ["postgresql", "://", "test_role", ":", "not-a-real-password", "@", host, ":5432/", database].join("");
}

describe("local destructive-test database boundary", () => {
  it("allows the legacy local test database and the frozen P0 lane databases", () => {
    for (const database of [
      "geoplane_local_test",
      "geoplane_p0_account_test",
      "geoplane_p0_keyword_test",
      "geoplane_p0_expansion_test",
      "geoplane_p0_probe_test",
      "geoplane_p0_policy_test",
      "geoplane_p0_agency_test",
      "geoplane_p0_integration_test",
    ]) {
      expect(() => assertSafeLocalTestDatabaseUrl(localUrl(database))).not.toThrow();
    }
  });

  it("refuses the local runtime database before a caller can construct a Pool", () => {
    expect(() =>
      assertSafeLocalTestDatabaseUrl(
        localUrl("geoplane_local_runtime"),
      ),
    ).toThrow("must target an explicitly allowlisted local test database");
  });

  it("enforces the guard at both shared test-config entry points", () => {
    const previous = process.env.GEO_TEST_DATABASE_URL;
    process.env.GEO_TEST_DATABASE_URL =
      localUrl("geoplane_local_runtime");
    try {
      expect(() => loadDatabaseConfig({ test: true })).toThrow("must target an explicitly allowlisted local test database");
      expect(() => loadDatabaseConfigForRole("test")).toThrow("must target an explicitly allowlisted local test database");
    } finally {
      if (previous === undefined) delete process.env.GEO_TEST_DATABASE_URL;
      else process.env.GEO_TEST_DATABASE_URL = previous;
    }
  });

  it("refuses approximate test names and non-loopback hosts", () => {
    expect(() =>
      assertSafeLocalTestDatabaseUrl(
        localUrl("geoplane_local_test_copy"),
      ),
    ).toThrow("must target an explicitly allowlisted local test database");
    expect(() =>
      assertSafeLocalTestDatabaseUrl(
        localUrl("geoplane_local_test", "database.example.test"),
      ),
    ).toThrow("must use a loopback host");
  });

  it("does not include credentials in refusal errors", () => {
    const marker = "DO_NOT_ECHO_THIS_PASSWORD";
    expect(() =>
      assertSafeLocalTestDatabaseUrl(
        ["postgresql", "://", "test_role", ":", marker, "@database.example.test:5432/geoplane_local_test"].join(""),
      ),
    ).toThrowError(expect.not.stringContaining(marker));
  });
});
