import { describe, expect, it } from "vitest";
import {
  ApiClientError,
  createApiClient,
  type FetchLike,
  type HttpResponseLike,
} from "../../../src/lib/api-client/http.js";
import {
  API_ERROR_HTTP_STATUS,
  type ApiErrorCodeV1,
  apiErr,
  apiOk,
} from "../../../src/runtime/api-contracts/index.js";

/** Build a fake fetch that returns a fixed status + raw body string. */
function fakeFetch(status: number, body: string, capture?: { calls: Array<{ url: string; init?: RequestInit }> }): FetchLike {
  return (url, init) => {
    capture?.calls.push({ url, init });
    const response: HttpResponseLike = {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    };
    return Promise.resolve(response);
  };
}

const ERROR_CODES: readonly ApiErrorCodeV1[] = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "INTERNAL_ERROR",
];

describe("createApiClient — success envelopes", () => {
  it("maps a well-formed ok envelope to { ok: true, data }", async () => {
    const payload = { id: "p-1", name: "Acme" };
    const client = createApiClient({ fetch: fakeFetch(200, JSON.stringify(apiOk(payload))) });

    const result = await client.request<typeof payload>("/api/projects/p-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(payload);
    }
  });

  it("passes method, headers and JSON body through to fetch", async () => {
    const capture = { calls: [] as Array<{ url: string; init?: RequestInit }> };
    const client = createApiClient({
      baseUrl: "https://api.test",
      fetch: fakeFetch(200, JSON.stringify(apiOk({ done: true })), capture),
    });

    await client.request("/api/thing", { method: "POST", body: { a: 1 } });

    expect(capture.calls).toHaveLength(1);
    const call = capture.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("expected a captured call");
    expect(call.url).toBe("https://api.test/api/thing");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe(JSON.stringify({ a: 1 }));
    const headers = call.init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");
  });
});

describe("createApiClient — error envelopes surface distinctly", () => {
  for (const code of ERROR_CODES) {
    it(`maps HTTP ${API_ERROR_HTTP_STATUS[code]} + envelope to ${code}`, async () => {
      const status = API_ERROR_HTTP_STATUS[code];
      const body = JSON.stringify(apiErr(code, `${code} happened`));
      const client = createApiClient({ fetch: fakeFetch(status, body) });

      const result = await client.request("/api/whatever");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(code);
        expect(result.message).toBe(`${code} happened`);
      }
    });
  }

  it("preserves error details when present", async () => {
    const body = JSON.stringify(apiErr("VALIDATION_FAILED", "bad", { field: "email" }));
    const client = createApiClient({ fetch: fakeFetch(422, body) });

    const result = await client.request("/api/x");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION_FAILED");
      expect(result.details).toEqual({ field: "email" });
    }
  });
});

describe("createApiClient — malformed / non-envelope responses", () => {
  it("maps a malformed (non-JSON) 500 to INTERNAL_ERROR without throwing", async () => {
    const client = createApiClient({ fetch: fakeFetch(500, "<html>gateway error</html>") });

    const result = await client.request("/api/x");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INTERNAL_ERROR");
    }
  });

  it("maps a non-2xx JSON body that is not an envelope to INTERNAL_ERROR", async () => {
    const client = createApiClient({ fetch: fakeFetch(503, JSON.stringify({ message: "down" })) });

    const result = await client.request("/api/x");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INTERNAL_ERROR");
    }
  });

  it("maps an empty non-2xx body to INTERNAL_ERROR", async () => {
    const client = createApiClient({ fetch: fakeFetch(502, "") });

    const result = await client.request("/api/x");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INTERNAL_ERROR");
    }
  });

  it("throws ApiClientError(PARSE) when a 2xx body is not a well-formed envelope", async () => {
    const client = createApiClient({ fetch: fakeFetch(200, "not json at all") });

    await expect(client.request("/api/x")).rejects.toBeInstanceOf(ApiClientError);
    await expect(client.request("/api/x")).rejects.toMatchObject({ kind: "PARSE" });
  });
});

describe("createApiClient — thrown errors reserved for transport failure", () => {
  it("throws ApiClientError(NETWORK) when fetch rejects", async () => {
    const boom: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));
    const client = createApiClient({ fetch: boom });

    await expect(client.request("/api/x")).rejects.toBeInstanceOf(ApiClientError);
    await expect(client.request("/api/x")).rejects.toMatchObject({ kind: "NETWORK" });
  });

  it("does NOT throw for any expected API error code", async () => {
    for (const code of ERROR_CODES) {
      const client = createApiClient({
        fetch: fakeFetch(API_ERROR_HTTP_STATUS[code], JSON.stringify(apiErr(code, "x"))),
      });
      await expect(client.request("/api/x")).resolves.toMatchObject({ ok: false, code });
    }
  });
});
