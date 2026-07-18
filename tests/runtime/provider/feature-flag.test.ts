/**
 * PROVIDER_PORT_AND_CONTRACT_V1 — feature-flag tests.
 *
 * Proves:
 *   - the provider runtime is OFF by default (unset / empty / falsey env);
 *   - only an explicit "true"/"1" (case-insensitive) turns it ON;
 *   - a REAL provider call attempted while the flag is off is REFUSED with
 *     PROVIDER_UNAVAILABLE, and the network is never touched.
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertRealProviderCallAllowed,
  isProviderRuntimeEnabled,
  ProviderRuntimeDisabledError,
  PROVIDER_RUNTIME_ENABLED_ENV_VAR,
} from "../../../src/runtime/provider/feature-flag.js";
import { ProviderErrorCode } from "../../../src/runtime/provider/errors.js";
import {
  providerErr,
  type ProviderGenerateArticleContentRequest,
  type ProviderPort,
  type ProviderResult,
} from "../../../src/runtime/provider/provider-port.js";

const REQUEST: ProviderGenerateArticleContentRequest = {
  projectId: "proj_acme_main_site",
  articleBriefId: "brief_0001",
  model: "gpt-offline-test",
  maxTokens: 1024,
  timeoutMs: 30000,
  requestId: "req_0001",
  idempotencyKey: "idem_0001",
};

describe("isProviderRuntimeEnabled — default OFF", () => {
  it("is false when the env var is unset entirely", () => {
    expect(isProviderRuntimeEnabled({})).toBe(false);
  });

  it("is false for empty / whitespace / falsey values", () => {
    for (const value of ["", "   ", "false", "FALSE", "0", "no", "off", "yes-ish", "trueish"]) {
      expect(isProviderRuntimeEnabled({ [PROVIDER_RUNTIME_ENABLED_ENV_VAR]: value })).toBe(false);
    }
  });

  it("is true only for explicit true/1 (case-insensitive, trimmed)", () => {
    for (const value of ["true", "TRUE", "  true  ", "1"]) {
      expect(isProviderRuntimeEnabled({ [PROVIDER_RUNTIME_ENABLED_ENV_VAR]: value })).toBe(true);
    }
  });

  it("defaults to process.env when no env is passed, and is not accidentally on in tests", () => {
    // The test environment must not enable the provider runtime by accident.
    expect(isProviderRuntimeEnabled()).toBe(false);
  });
});

describe("assertRealProviderCallAllowed — guard", () => {
  it("throws ProviderRuntimeDisabledError (PROVIDER_UNAVAILABLE) when disabled", () => {
    try {
      assertRealProviderCallAllowed({ [PROVIDER_RUNTIME_ENABLED_ENV_VAR]: "false" });
      expect.unreachable("guard should have thrown while disabled");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderRuntimeDisabledError);
      expect((error as ProviderRuntimeDisabledError).code).toBe(
        ProviderErrorCode.PROVIDER_UNAVAILABLE,
      );
    }
  });

  it("does not throw when explicitly enabled", () => {
    expect(() =>
      assertRealProviderCallAllowed({ [PROVIDER_RUNTIME_ENABLED_ENV_VAR]: "true" }),
    ).not.toThrow();
  });
});

/**
 * A stand-in "real" (network-shaped) adapter: it guards on the flag BEFORE it
 * would ever touch the network. This models exactly what the D2 real adapter
 * must do. The fetch spy proves the network is never reached while off.
 */
class FakeRealNetworkAdapter implements ProviderPort {
  constructor(private readonly env: Record<string, string | undefined>) {}

  async generateArticleContent(
    _request: ProviderGenerateArticleContentRequest,
  ): Promise<ProviderResult> {
    assertRealProviderCallAllowed(this.env); // refuses here while disabled
    // Anything past this line would be the real network call — unreachable while off.
    await fetch("https://api.example.invalid/v1/chat/completions");
    return providerErr(ProviderErrorCode.PROVIDER_UNAVAILABLE);
  }
}

describe("real provider call refused while flag is off", () => {
  it("refuses the call and never touches the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network must never be called while the provider runtime is off"),
    );
    try {
      const adapter = new FakeRealNetworkAdapter({
        [PROVIDER_RUNTIME_ENABLED_ENV_VAR]: "false",
      });
      await expect(adapter.generateArticleContent(REQUEST)).rejects.toBeInstanceOf(
        ProviderRuntimeDisabledError,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
