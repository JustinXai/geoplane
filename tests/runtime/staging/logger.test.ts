/**
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1) — structured-logger redaction tests.
 *
 * The load-bearing guarantee: the logger emits ONLY the allowlisted safe fields, and its
 * redaction guard scrubs every forbidden field (cookie / token / api key / signing key /
 * knowledge raw text / provider prompt / provider response) even when a caller explicitly
 * asks to log it.
 */
import { describe, expect, it } from "vitest";
import {
  createLogger,
  isForbiddenKey,
  redactForbidden,
  REDACTED,
  type StructuredLogRecord,
} from "../../../src/runtime/observability/logger.js";

function capture(): { records: StructuredLogRecord[]; sink: (r: StructuredLogRecord) => void } {
  const records: StructuredLogRecord[] = [];
  return { records, sink: (r) => records.push(r) };
}

describe("structured logger — allowlist", () => {
  it("emits exactly the safe fields it was given", () => {
    const { records, sink } = capture();
    const logger = createLogger({ sink, now: () => new Date("2026-07-18T00:00:00Z") });

    logger.info({
      requestId: "req-1",
      actorUserId: "u-1",
      actorOrganizationId: "org-1",
      clientOrganizationId: "client-1",
      projectId: "proj-1",
      route: "/api/health/ready",
      status: 200,
      latencyMs: 12,
      errorCode: null,
    });

    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec).toMatchObject({
      level: "info",
      requestId: "req-1",
      actorUserId: "u-1",
      actorOrganizationId: "org-1",
      clientOrganizationId: "client-1",
      projectId: "proj-1",
      route: "/api/health/ready",
      status: 200,
      latencyMs: 12,
      errorCode: null,
    });
  });

  it("drops forbidden top-level fields even when asked to log them", () => {
    const { records, sink } = capture();
    const logger = createLogger({ sink });

    // A caller mistakenly spreads a request context full of secrets into the log call.
    logger.error({
      requestId: "req-2",
      route: "/api/knowledge",
      status: 500,
      errorCode: "INTERNAL_ERROR",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( {
        cookie: "geo_session=abc123",
        token: "bearer-xyz",
        apiKey: "sk-live-super-secret",
        authorization: "Bearer leak",
        knowledgeText: "raw confidential enterprise document text",
        providerPrompt: "system: do the thing",
        providerResponse: "the model said this",
      } as any),
    });

    const rec = records[0]!;
    const serialized = JSON.stringify(rec);
    // Neither the forbidden KEYS nor their VALUES may appear anywhere in the emitted record.
    for (const needle of [
      "cookie",
      "token",
      "apiKey",
      "authorization",
      "knowledgeText",
      "providerPrompt",
      "providerResponse",
      "abc123",
      "bearer-xyz",
      "sk-live-super-secret",
      "confidential enterprise document",
      "the model said this",
    ]) {
      expect(serialized).not.toContain(needle);
    }
    // The safe fields survive.
    expect(rec.requestId).toBe("req-2");
    expect(rec.errorCode).toBe("INTERNAL_ERROR");
  });

  it("deep-redacts a free-form context bag", () => {
    const { records, sink } = capture();
    const logger = createLogger({ sink });

    logger.warn({
      route: "/api/provider",
      context: {
        safe: "keep-me",
        cookie: "should-vanish",
        nested: {
          providerResponse: "secret completion",
          apiKey: "sk-123",
          alsoSafe: 42,
        },
        list: [{ token: "t1" }, { keep: "yes" }],
      },
    });

    const ctx = records[0]!.context as Record<string, unknown>;
    expect(ctx.safe).toBe("keep-me");
    expect(ctx.cookie).toBe(REDACTED);
    const nested = ctx.nested as Record<string, unknown>;
    expect(nested.providerResponse).toBe(REDACTED);
    expect(nested.apiKey).toBe(REDACTED);
    expect(nested.alsoSafe).toBe(42);
    const list = ctx.list as Array<Record<string, unknown>>;
    expect(list[0]!.token).toBe(REDACTED);
    expect(list[1]!.keep).toBe("yes");
    expect(JSON.stringify(records[0])).not.toContain("secret completion");
  });
});

describe("redaction guard", () => {
  it("flags forbidden key names case-insensitively", () => {
    for (const key of [
      "cookie",
      "Cookie",
      "sessionToken",
      "api_key",
      "apiKey",
      "api-key",
      "Authorization",
      "signingKey",
      "session_key",
      "providerPrompt",
      "provider_response",
      "knowledgeText",
      "rawText",
      "content_text",
      "password",
      "bearerToken",
      "credentials",
    ]) {
      expect(isForbiddenKey(key)).toBe(true);
    }
  });

  it("leaves ordinary key names alone", () => {
    for (const key of ["requestId", "route", "status", "latencyMs", "projectId", "count"]) {
      expect(isForbiddenKey(key)).toBe(false);
    }
  });

  it("handles cycles without throwing", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const out = redactForbidden(obj) as Record<string, unknown>;
    expect(out.a).toBe(1);
    expect(out.self).toBe("[Circular]");
  });

  it("returns primitives unchanged", () => {
    expect(redactForbidden("hello")).toBe("hello");
    expect(redactForbidden(7)).toBe(7);
    expect(redactForbidden(null)).toBeNull();
  });
});
