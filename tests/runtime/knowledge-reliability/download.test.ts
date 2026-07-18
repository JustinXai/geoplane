/**
 * Tests for KNOWLEDGE_INGESTION_RELIABILITY_V1 (Agent F) — the URL download helper.
 *
 * The helper performs the ONLY network I/O in knowledge ingestion; here fetch is faked so no
 * real network is touched. Classification exercised:
 *   - happy path: HTML 2xx -> bytes + content-type returned for the parser,
 *   - timeout (fetch never resolves within the budget) -> URL_TIMEOUT,
 *   - fetch rejects (network error) -> DOWNLOAD_FAILED,
 *   - non-2xx status -> DOWNLOAD_FAILED,
 *   - non-HTML content-type -> URL_NOT_HTML.
 */
import { describe, expect, it } from "vitest";
import {
  fetchUrlDocument,
  type FetchLike,
  type FetchLikeResponse,
} from "../../../src/runtime/knowledge/download/index.js";
import type { KnowledgeErrorCode } from "../../../src/runtime/knowledge/parsers/index.js";

function htmlResponse(body: string, contentType = "text/html; charset=utf-8"): FetchLikeResponse {
  const bytes = new Uint8Array(Buffer.from(body, "utf8"));
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function statusResponse(status: number, contentType = "text/html"): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function expectError(
  result: { ok: true } | { ok: false; error: { code: KnowledgeErrorCode } },
  code: KnowledgeErrorCode,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`expected failure ${code} but fetch succeeded`);
  expect(result.error.code).toBe(code);
}

describe("fetchUrlDocument", () => {
  it("returns bytes + content-type for an HTML 2xx response", async () => {
    const fetchImpl: FetchLike = async () => htmlResponse("<html><body>Hi</body></html>");
    const res = await fetchUrlDocument({ url: "https://example.com/page", fetchImpl });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.url).toBe("https://example.com/page");
    expect(res.value.contentType).toBe("text/html; charset=utf-8");
    expect(Buffer.from(res.value.bytes).toString("utf8")).toBe("<html><body>Hi</body></html>");
  });

  it("classifies a slow fetch that overruns the timeout budget as URL_TIMEOUT", async () => {
    // fetch resolves only when its signal aborts — modelling a hung request the timer cancels.
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise<FetchLikeResponse>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }
      });
    const res = await fetchUrlDocument({
      url: "https://slow.example.com",
      timeoutMs: 10,
      fetchImpl,
    });
    expectError(res, "URL_TIMEOUT");
  });

  it("classifies a rejected fetch (network error) as DOWNLOAD_FAILED", async () => {
    const fetchImpl: FetchLike = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { name: "TypeError" });
    };
    const res = await fetchUrlDocument({ url: "https://nope.invalid", fetchImpl });
    expectError(res, "DOWNLOAD_FAILED");
  });

  it("classifies a non-2xx status as DOWNLOAD_FAILED", async () => {
    const fetchImpl: FetchLike = async () => statusResponse(404);
    const res = await fetchUrlDocument({ url: "https://example.com/missing", fetchImpl });
    expectError(res, "DOWNLOAD_FAILED");
  });

  it("classifies a non-HTML content-type as URL_NOT_HTML", async () => {
    const fetchImpl: FetchLike = async () =>
      htmlResponse("%PDF-1.4", "application/pdf");
    const res = await fetchUrlDocument({ url: "https://example.com/file.pdf", fetchImpl });
    expectError(res, "URL_NOT_HTML");
  });

  it("treats a missing content-type as non-HTML (URL_NOT_HTML)", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const res = await fetchUrlDocument({ url: "https://example.com/unknown", fetchImpl });
    expectError(res, "URL_NOT_HTML");
  });
});
