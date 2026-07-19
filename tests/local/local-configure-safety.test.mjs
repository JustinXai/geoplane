import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  serializeLocalConfiguration,
  validateLocalConfiguration,
  writeLocalConfigurationAtomic,
} from "../../scripts/local/configure-lib.mjs";
import { repoRoot } from "../../scripts/local/runtime-lib.mjs";

function validEnvironment() {
  return {
    GEO_DATABASE_URL: "postgresql://local_role:local-db-password@127.0.0.1:5432/geoplane_local_runtime",
    GEO_TEST_DATABASE_URL: "postgresql://local_role:local-db-password@127.0.0.1:5432/geoplane_local_test",
    GEO_CANARY_DATABASE_URL: "postgresql://local_role:local-db-password@127.0.0.1:5432/geoplane_local_canary",
    SESSION_SIGNING_KEY_CURRENT: "session-local-key-0000000000000000000000",
    REVIEW_REFERENCE_KEY_CURRENT: "review-local-key-00000000000000000000000",
    PROVIDER_RUNTIME_ENABLED: "false",
    LOCAL_APP_PORT: "3010",
  };
}

describe("secret-safe local configuration", () => {
  it("validates exact targets, distinct strong keys, and Provider OFF", () => {
    const values = validateLocalConfiguration(validEnvironment());
    expect(values.LOCAL_ONLY_MODE).toBe("true");
    expect(values.PROVIDER_RUNTIME_ENABLED).toBe("false");
    expect(values.LOCAL_APP_PORT).toBe("3010");
  });

  it("blocks placeholders, runtime-as-test, shared keys, and Provider ON", () => {
    expect(() => validateLocalConfiguration({ ...validEnvironment(), SESSION_SIGNING_KEY_CURRENT: "CHANGE_ME_000000000000000000000000" })).toThrow("placeholder");
    expect(() => validateLocalConfiguration({ ...validEnvironment(), GEO_TEST_DATABASE_URL: validEnvironment().GEO_DATABASE_URL })).toThrow("geoplane_local_test");
    expect(() => validateLocalConfiguration({ ...validEnvironment(), REVIEW_REFERENCE_KEY_CURRENT: validEnvironment().SESSION_SIGNING_KEY_CURRENT })).toThrow("must be distinct");
    expect(() => validateLocalConfiguration({ ...validEnvironment(), PROVIDER_RUNTIME_ENABLED: "true" })).toThrow("explicitly false");
    expect(() => validateLocalConfiguration({ ...validEnvironment(), GEO_DATABASE_URL: "postgresql://local_role@127.0.0.1:5432/geoplane_local_runtime" })).toThrow("database credential");
  });

  it("writes a complete file atomically with restrictive POSIX mode where supported", () => {
    const root = mkdtempSync(join(tmpdir(), "geoplane-local-config-"));
    try {
      const values = validateLocalConfiguration(validEnvironment());
      const target = writeLocalConfigurationAtomic(root, values);
      expect(readFileSync(target, "utf8")).toBe(serializeLocalConfiguration(values));
      if (process.platform !== "win32") expect(statSync(target).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("check mode never prints secrets and never writes the repository config", () => {
    const environment = validEnvironment();
    const before = (() => {
      try { return statSync(join(repoRoot, ".env.local")).mtimeMs; } catch { return null; }
    })();
    const output = execFileSync(process.execPath, [join(repoRoot, "scripts", "local", "configure.mjs"), "--check"], {
      cwd: repoRoot,
      env: { ...process.env, ...environment },
      encoding: "utf8",
    });
    for (const value of Object.values(environment)) expect(output).not.toContain(value);
    expect(output).toContain("CHECK PASS (no file written)");
    const after = (() => {
      try { return statSync(join(repoRoot, ".env.local")).mtimeMs; } catch { return null; }
    })();
    expect(after).toBe(before);
  });
});
