/**
 * PROVIDER_PORT_AND_CONTRACT_V1 — port contract + error taxonomy tests.
 *
 * Proves:
 *   - the error taxonomy is complete (all seven codes present, no duplicates);
 *   - the request contract requires all mandated fields, both at the TYPE level
 *     (@ts-expect-error on partial literals) and at RUNTIME
 *     (validateProviderGenerateRequest);
 *   - ProviderResult is a discriminated union with ok/err constructors;
 *   - records carry no api-key/secret field.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isProviderErrorCode,
  PROVIDER_ERROR_CODES,
  ProviderErrorCode,
} from "../../../src/runtime/provider/errors.js";
import {
  providerErr,
  providerOk,
  REQUIRED_PROVIDER_REQUEST_FIELDS,
  validateProviderGenerateRequest,
  type ProviderArticleContentV1,
  type ProviderGenerateArticleContentRequest,
  PROVIDER_ARTICLE_CONTENT_V1,
} from "../../../src/runtime/provider/provider-port.js";

describe("error taxonomy is complete", () => {
  it("contains exactly the seven mandated codes, no duplicates", () => {
    const expected = [
      "PROVIDER_TIMEOUT",
      "PROVIDER_RATE_LIMIT",
      "PROVIDER_AUTH_FAILED",
      "PROVIDER_CONTRACT_INVALID",
      "PROVIDER_EMPTY_RESPONSE",
      "PROVIDER_TOKEN_LIMIT",
      "PROVIDER_UNAVAILABLE",
    ];
    const actual = PROVIDER_ERROR_CODES.map((code) => code.toString());
    expect(new Set(actual).size).toBe(actual.length); // no duplicates
    expect(new Set(actual)).toEqual(new Set(expected));
    expect(actual.length).toBe(7);
  });

  it("every taxonomy code round-trips through the type-guard", () => {
    for (const code of PROVIDER_ERROR_CODES) {
      expect(isProviderErrorCode(code)).toBe(true);
    }
    expect(isProviderErrorCode("NOT_A_CODE")).toBe(false);
    expect(isProviderErrorCode(undefined)).toBe(false);
  });
});

describe("ProviderResult discriminated union", () => {
  it("providerOk carries content; providerErr carries a taxonomy code", () => {
    const content: ProviderArticleContentV1 = {
      schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
      title: "t",
      summary: "s",
      sections: [{ heading: "h", body: "b" }],
    };
    const ok = providerOk(content);
    const err = providerErr(ProviderErrorCode.PROVIDER_TIMEOUT);
    expect(ok.ok).toBe(true);
    expect(err.ok).toBe(false);
    if (ok.ok) expect(ok.content).toBe(content);
    if (!err.ok) expect(err.error).toBe(ProviderErrorCode.PROVIDER_TIMEOUT);
  });
});

describe("request contract requires all mandated fields — TYPE level", () => {
  it("a partial request literal does not type-check", () => {
    // @ts-expect-error — idempotencyKey (and the rest) are required, not optional.
    const missingIdempotencyKey: ProviderGenerateArticleContentRequest = {
      projectId: "p",
      articleBriefId: "b",
      model: "m",
      maxTokens: 1,
      timeoutMs: 1,
      requestId: "r",
    };
    void missingIdempotencyKey;

    // @ts-expect-error — an empty object is not a valid request.
    const empty: ProviderGenerateArticleContentRequest = {};
    void empty;
  });
});

describe("request contract requires all mandated fields — RUNTIME guard", () => {
  const complete: ProviderGenerateArticleContentRequest = {
    projectId: "proj_acme_main_site",
    articleBriefId: "brief_0001",
    model: "gpt-offline-test",
    maxTokens: 1024,
    timeoutMs: 30000,
    requestId: "req_0001",
    idempotencyKey: "idem_0001",
  };

  it("accepts a complete request", () => {
    const result = validateProviderGenerateRequest(complete);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request).toEqual(complete);
  });

  it("lists every mandated field as invalid for an empty object", () => {
    const result = validateProviderGenerateRequest({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
      expect(new Set(result.invalidFields)).toEqual(new Set(REQUIRED_PROVIDER_REQUEST_FIELDS));
    }
  });

  it("rejects each missing/blank/non-positive field individually", () => {
    const mutations: Array<[string, Partial<Record<string, unknown>>]> = [
      ["projectId", { projectId: "" }],
      ["articleBriefId", { articleBriefId: "  " }],
      ["model", { model: undefined }],
      ["maxTokens", { maxTokens: 0 }],
      ["maxTokens", { maxTokens: -5 }],
      ["maxTokens", { maxTokens: 1.5 }],
      ["timeoutMs", { timeoutMs: -1 }],
      ["requestId", { requestId: "" }],
      ["idempotencyKey", { idempotencyKey: null }],
    ];
    for (const [field, mutation] of mutations) {
      const result = validateProviderGenerateRequest({ ...complete, ...mutation });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.invalidFields).toContain(field);
      }
    }
  });
});

describe("records carry no secret field", () => {
  it("records.ts source declares no api-key / token / credential field", () => {
    const source = readFileSync(
      new URL("../../../src/runtime/provider/records.ts", import.meta.url),
      "utf8",
    );
    // Strip block comments so the doc-comment's own "No secrets" prose (which
    // mentions api key / token / credential to explain the ban) is not matched.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const forbiddenFieldPattern =
      /\b(apiKey|api_key|apikey|secret|token(?!s\b)|bearer|authorization|credential|password)\b/i;
    // `tokens` (plural, as in promptTokens/totalTokens) is allowed; a bare
    // `token` field is not. The negative lookahead above lets "Tokens" through.
    expect(forbiddenFieldPattern.test(codeOnly)).toBe(false);
  });
});
