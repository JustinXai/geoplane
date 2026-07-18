/**
 * PROVIDER_PORT_AND_CONTRACT_V1 — deterministic offline adapter tests.
 *
 * Proves:
 *   - same request -> byte-identical (deep-equal) content (determinism);
 *   - different requests -> different content;
 *   - PROVIDER REAL CALLS = 0: the network is never touched (fetch spy) and the
 *     adapter's source has no network/provider-SDK-shaped import at all;
 *   - the adapter produces only governance-free user-visible content;
 *   - a malformed request is refused by the runtime guard.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DeterministicOfflineProviderAdapter } from "../../../src/runtime/provider/deterministic-offline-adapter.js";
import { validateProviderContent } from "../../../src/runtime/provider/contract-validation.js";
import { ProviderErrorCode } from "../../../src/runtime/provider/errors.js";
import {
  PROVIDER_ARTICLE_CONTENT_V1,
  type ProviderGenerateArticleContentRequest,
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

describe("DeterministicOfflineProviderAdapter — determinism", () => {
  it("returns deep-equal content for the same request, every time", async () => {
    const adapter = new DeterministicOfflineProviderAdapter();
    const a = await adapter.generateArticleContent(REQUEST);
    const b = await adapter.generateArticleContent(REQUEST);
    const c = await new DeterministicOfflineProviderAdapter().generateArticleContent(REQUEST);
    expect(a.ok).toBe(true);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it("returns different content for a different request", async () => {
    const adapter = new DeterministicOfflineProviderAdapter();
    const a = await adapter.generateArticleContent(REQUEST);
    const b = await adapter.generateArticleContent({ ...REQUEST, articleBriefId: "brief_0002" });
    expect(a).not.toEqual(b);
  });

  it("produces valid, governance-free user-visible content", async () => {
    const adapter = new DeterministicOfflineProviderAdapter();
    const result = await adapter.generateArticleContent(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.schemaVersion).toBe(PROVIDER_ARTICLE_CONTENT_V1);
      expect(result.content.sections.length).toBeGreaterThanOrEqual(2);
      // Re-validating the adapter's own output must still pass the firewall.
      expect(validateProviderContent(result.content).ok).toBe(true);
    }
  });
});

describe("DeterministicOfflineProviderAdapter — PROVIDER REAL CALLS = 0", () => {
  it("never calls fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("offline adapter must never call the network"),
    );
    try {
      const adapter = new DeterministicOfflineProviderAdapter();
      await adapter.generateArticleContent(REQUEST);
      await adapter.generateArticleContent({ ...REQUEST, requestId: "req_0002" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("has no network/provider-SDK-shaped import in its source", () => {
    const source = readFileSync(
      new URL(
        "../../../src/runtime/provider/deterministic-offline-adapter.ts",
        import.meta.url,
      ),
      "utf8",
    );
    // Actual `import ... from "..."` / `import("...")` / `require("...")`
    // specifiers only (not doc-comment prose that discusses "no fetch").
    const specifiers = [
      ...source.matchAll(/^\s*import[^"']*from\s*["']([^"']+)["']/gm),
      ...source.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1] ?? "");

    const forbidden =
      /\b(fetch|node-fetch|undici|axios|got|superagent|xmlhttprequest|openai|anthropic|@anthropic-ai|grpc|ws|websocket|https?:\/\/|node:http|node:https|node:net|node:tls)\b/i;
    for (const specifier of specifiers) {
      expect(forbidden.test(specifier)).toBe(false);
    }
    // Every import must resolve within this provider lane (relative ./ path).
    for (const specifier of specifiers) {
      expect(specifier.startsWith("./")).toBe(true);
    }
  });
});

describe("DeterministicOfflineProviderAdapter — request runtime guard", () => {
  it("refuses a malformed request with PROVIDER_CONTRACT_INVALID", async () => {
    const adapter = new DeterministicOfflineProviderAdapter();
    // Missing required fields — arrives as if from untyped JSON.
    const bad = { projectId: "", articleBriefId: "brief_0001" } as unknown as ProviderGenerateArticleContentRequest;
    const result = await adapter.generateArticleContent(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
    }
  });
});
