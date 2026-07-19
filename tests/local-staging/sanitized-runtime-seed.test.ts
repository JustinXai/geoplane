import { describe, expect, it } from "vitest";
import {
  SANITIZED_RUNTIME_FIXTURES,
  validateSeedEnvironment,
} from "../../scripts/local/seed-sanitized-pilot.mjs";

const safe = {
  GEO_DATABASE_URL: "postgresql://local:local@127.0.0.1:5432/geoplane_local_runtime",
  PROVIDER_RUNTIME_ENABLED: "false",
  SESSION_SIGNING_KEY_CURRENT: "local-session-key-which-is-not-committed",
  REVIEW_REFERENCE_KEY_CURRENT: "local-review-key-which-is-not-committed",
  LOCAL_PLATFORM_ADMIN_PASSWORD: "Local-Platform-7xK3",
  LOCAL_AGENCY_OWNER_PASSWORD: "Local-Agency-8yL4",
  LOCAL_CLIENT_OWNER_PASSWORD: "Local-Client-9zM5",
};

describe("LOCAL_SANITIZED_RUNTIME_SEED_V1 containment", () => {
  it("accepts only the dedicated loopback runtime database with three distinct passwords", () => {
    expect(validateSeedEnvironment(safe)).toEqual({
      host: "127.0.0.1",
      database: "geoplane_local_runtime",
    });
  });

  it.each([
    ["test DB", { GEO_DATABASE_URL: "postgresql://local:local@127.0.0.1/geoplane_local_test" }],
    ["remote host", { GEO_DATABASE_URL: "postgresql://local:local@db.example.test/geoplane_local_runtime" }],
    ["provider enabled", { PROVIDER_RUNTIME_ENABLED: "true" }],
    ["missing session key", { SESSION_SIGNING_KEY_CURRENT: undefined }],
    ["missing review key", { REVIEW_REFERENCE_KEY_CURRENT: undefined }],
    ["missing password", { LOCAL_CLIENT_OWNER_PASSWORD: undefined }],
    ["placeholder password", { LOCAL_CLIENT_OWNER_PASSWORD: "ChangeMe-Password-1" }],
    ["shared password", { LOCAL_CLIENT_OWNER_PASSWORD: safe.LOCAL_AGENCY_OWNER_PASSWORD }],
  ])("rejects %s before connecting", (_label, override) => {
    expect(() => validateSeedEnvironment({ ...safe, ...override })).toThrow();
  });

  it("uses only reserved test domains and explicit sample fixture names", () => {
    for (const fixture of [
      SANITIZED_RUNTIME_FIXTURES.platform,
      SANITIZED_RUNTIME_FIXTURES.agency,
      SANITIZED_RUNTIME_FIXTURES.client,
    ]) {
      expect(fixture.email).toMatch(/\.example\.test$/);
      expect(fixture.orgName).toMatch(/sample|pilot fixture/i);
    }
  });
});
