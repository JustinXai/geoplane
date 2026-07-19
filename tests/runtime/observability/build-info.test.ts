import { describe, expect, it } from "vitest";
import { readBuildInfo } from "../../../src/runtime/observability/build-info.js";

describe("internal build information", () => {
  it("reports artifact identity, frozen migration head, and provider OFF", () => {
    expect(readBuildInfo({
      GEO_BUILD_BRANCH: "local/example",
      GEO_BUILD_GIT_SHA: "0123456789abcdef",
      GEO_BUILD_TIME: "2026-07-19T12:00:00.000Z",
      PROVIDER_RUNTIME_ENABLED: "false",
    })).toEqual({
      branch: "local/example",
      gitSha: "0123456789abcdef",
      buildTime: "2026-07-19T12:00:00.000Z",
      migrationHead: "0017",
      providerRuntime: "OFF",
    });
  });

  it("does not falsely claim provider OFF for absent or enabled configuration", () => {
    expect(readBuildInfo({}).providerRuntime).toBe("INVALID_CONFIGURATION");
    expect(readBuildInfo({ PROVIDER_RUNTIME_ENABLED: "true" }).providerRuntime).toBe("INVALID_CONFIGURATION");
  });

  it("sanitizes unexpected build metadata", () => {
    const info = readBuildInfo({ GEO_BUILD_BRANCH: "branch\nsecret=value", PROVIDER_RUNTIME_ENABLED: "false" });
    expect(info.branch).toBe("unknown");
  });
});
