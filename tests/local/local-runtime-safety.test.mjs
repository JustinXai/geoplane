import { describe, expect, it } from "vitest";
import {
  LOCAL_DATABASES,
  LOCAL_MIGRATIONS,
  databaseErrorDetail,
  localPort,
  parseLocalDatabaseUrl,
  sanitizedError,
} from "../../scripts/local/runtime-lib.mjs";

const localUrl = (database) => `postgresql://local_user:hidden-value@127.0.0.1:5432/${database}`;

describe("LOCAL_ENVIRONMENT_RUNTIME_V1 safety boundary", () => {
  it("accepts only the three exact local-purpose database names", () => {
    for (const [role, definition] of Object.entries(LOCAL_DATABASES)) {
      expect(parseLocalDatabaseUrl(localUrl(definition.name), role).database).toBe(definition.name);
      expect(() => parseLocalDatabaseUrl(localUrl(`${definition.name}_other`), role)).toThrow(
        `must target exactly ${definition.name}`,
      );
    }
  });

  it("refuses non-loopback database hosts", () => {
    expect(() =>
      parseLocalDatabaseUrl("postgresql://local_user:hidden-value@db.example.test/geoplane_local_runtime", "runtime"),
    ).toThrow("must use a loopback host");
  });

  it("pins the frozen local stage migration range", () => {
    expect(LOCAL_MIGRATIONS).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]);
  });

  it("redacts complete database URLs and configured secret values", () => {
    const secretUrl = localUrl("geoplane_local_runtime");
    const secretKey = "not-for-output-01234567890123456789";
    const environment = {
      resolveValue(name) {
        if (name === "GEO_DATABASE_URL") return secretUrl;
        if (name === "SESSION_SIGNING_KEY_CURRENT") return secretKey;
        return null;
      },
    };
    const result = sanitizedError(new Error(`failure ${secretUrl} ${secretKey}`), environment);
    expect(result).not.toContain(secretUrl);
    expect(result).not.toContain(secretKey);
    expect(result).toContain("[REDACTED_DATABASE_URL]");
  });

  it("does not echo driver authentication messages", () => {
    const error = Object.assign(new Error('password authentication failed for user "sensitive_role"'), {
      code: "28P01",
    });
    const detail = databaseErrorDetail(error, "runtime");
    expect(detail).toBe("geoplane_local_runtime: authentication failed");
    expect(detail).not.toContain("sensitive_role");
  });

  it("accepts only an unprivileged valid local application port", () => {
    expect(localPort((name) => (name === "LOCAL_APP_PORT" ? "3010" : null))).toBe(3010);
    expect(() => localPort(() => "80")).toThrow("1024 through 65535");
  });
});
