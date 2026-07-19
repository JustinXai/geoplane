import { describe, expect, it } from "vitest";
import {
  makeContainedChildEnvironment,
  validateLocalPilotEnvironment,
} from "../../scripts/local/functional-pilot.mjs";

const safeEnvironment = {
  GEO_TEST_DATABASE_URL:
    "postgresql://sanitized_user:local-only-password@127.0.0.1:5432/geoplane_local_test",
  GEO_DATABASE_URL:
    "postgresql://sanitized_user:local-only-password@127.0.0.1:5432/geoplane_local_runtime",
  GEO_CANARY_DATABASE_URL:
    "postgresql://sanitized_user:local-only-password@127.0.0.1:5432/geoplane_local_canary",
  PROVIDER_RUNTIME_ENABLED: "false",
  SESSION_SIGNING_KEY_CURRENT: "local-functional-session-key-not-a-secret-0001",
  REVIEW_REFERENCE_KEY_CURRENT: "local-functional-review-key-not-a-secret-0001",
};

describe("LOCAL_FUNCTIONAL_PILOT_V1 runner containment", () => {
  it("accepts only the dedicated loopback local test database with provider OFF", () => {
    expect(validateLocalPilotEnvironment(safeEnvironment)).toEqual({
      database: "geoplane_local_test",
      host: "127.0.0.1",
      port: "5432",
    });
  });

  it.each([
    ["runtime database", { GEO_TEST_DATABASE_URL: safeEnvironment.GEO_DATABASE_URL }],
    ["non-loopback host", { GEO_TEST_DATABASE_URL: "postgresql://user:pw@db.example.test/geoplane_local_test" }],
    ["provider enabled", { PROVIDER_RUNTIME_ENABLED: "true" }],
    ["provider flag unset", { PROVIDER_RUNTIME_ENABLED: undefined }],
    ["canary enabled", { RUN_PROVIDER_CANARY: "true" }],
    ["session key missing", { SESSION_SIGNING_KEY_CURRENT: undefined }],
    ["review key missing", { REVIEW_REFERENCE_KEY_CURRENT: undefined }],
    ["test/runtime alias", { GEO_DATABASE_URL: safeEnvironment.GEO_TEST_DATABASE_URL }],
    ["test/canary alias", { GEO_CANARY_DATABASE_URL: safeEnvironment.GEO_TEST_DATABASE_URL }],
  ])("rejects %s before any test or database action", (_label, override) => {
    expect(() => validateLocalPilotEnvironment({ ...safeEnvironment, ...override })).toThrow();
  });

  it("strips live-provider configuration and forces all provider switches OFF in the child", () => {
    const child = makeContainedChildEnvironment({
      ...safeEnvironment,
      DEEPSEEK_API_KEY: "must-not-reach-child",
      PROVIDER_API_KEY: "must-not-reach-child",
      PROVIDER_BASE_URL: "https://provider.invalid",
      PROVIDER_MODEL: "live-model",
      RUN_PROVIDER_CANARY: "true",
    });
    expect(child.DEEPSEEK_API_KEY).toBeUndefined();
    expect(child.PROVIDER_API_KEY).toBeUndefined();
    expect(child.PROVIDER_BASE_URL).toBeUndefined();
    expect(child.PROVIDER_MODEL).toBeUndefined();
    expect(child.PROVIDER_RUNTIME_ENABLED).toBe("false");
    expect(child.RUN_PROVIDER_CANARY).toBe("false");
    expect(child.NODE_ENV).toBe("test");
  });
});
