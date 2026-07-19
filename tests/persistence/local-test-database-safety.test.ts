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
  it("allows only the exact loopback geoplane_local_test database", () => {
    expect(() =>
      assertSafeLocalTestDatabaseUrl(
        localUrl("geoplane_local_test"),
      ),
    ).not.toThrow();
  });

  it("refuses the local runtime database before a caller can construct a Pool", () => {
    expect(() =>
      assertSafeLocalTestDatabaseUrl(
        localUrl("geoplane_local_runtime"),
      ),
    ).toThrow("must target exactly geoplane_local_test");
  });

  it("enforces the guard at both shared test-config entry points", () => {
    const previous = process.env.GEO_TEST_DATABASE_URL;
    process.env.GEO_TEST_DATABASE_URL =
      localUrl("geoplane_local_runtime");
    try {
      expect(() => loadDatabaseConfig({ test: true })).toThrow("must target exactly geoplane_local_test");
      expect(() => loadDatabaseConfigForRole("test")).toThrow("must target exactly geoplane_local_test");
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
    ).toThrow("must target exactly geoplane_local_test");
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
