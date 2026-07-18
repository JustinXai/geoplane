/**
 * OPENAI_COMPATIBLE_ADAPTER_V1 (checkpoint D2) — OFFLINE adapter tests.
 *
 * ZERO REAL NETWORK. Every test injects a fake `fetch`; a suite-wide spy on the
 * global fetch throws and is asserted never-called, so a real request is
 * impossible even if a path forgot to inject.
 *
 * Proves:
 *   - a good completion -> ProviderArticleContentV1 (0 governance) + a usage
 *     record with the response's token counts + an OK execution record;
 *   - every taxonomy error class is mapped from the right transport signal;
 *   - the SINGLE AbortController timeout aborts within the budget -> TIMEOUT;
 *   - MAX ONE retry on 429 (retry-once-then-fail, and retry-then-succeed);
 *   - the call is REFUSED (PROVIDER_UNAVAILABLE) when the runtime flag is off,
 *     and the network is never touched;
 *   - a model not in the allowed set is rejected without a network call
 *     (never auto-switch);
 *   - the single max-token cap clamps `max_tokens`, and the model is sent verbatim;
 *   - the API key never appears in any record, result, or console output;
 *   - the adapter's source imports no OpenAI SDK / network dependency.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ALLOWED_MODELS,
  OpenAICompatibleProviderAdapter,
  type FetchLike,
  type ProviderCallObserver,
} from "../../../src/runtime/provider/openai-compatible-adapter.js";
import { ProviderErrorCode } from "../../../src/runtime/provider/errors.js";
import {
  DEFAULT_PROVIDER_IDENTITY,
  type ProviderIdentity,
} from "../../../src/runtime/provider/identity.js";
import { validateProviderContent } from "../../../src/runtime/provider/contract-validation.js";
import { PROVIDER_ARTICLE_CONTENT_V1, type ProviderGenerateArticleContentRequest } from "../../../src/runtime/provider/provider-port.js";
import type {
  ProviderExecutionRecord,
  ProviderFailureRecord,
  ProviderUsageRecord,
} from "../../../src/runtime/provider/records.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A distinctive canary so any leak of the key is unmistakable in a scan. */
const SECRET_KEY = "sk-LEAK-CANARY-9f8e7d6c5b4a-do-not-store-or-log";

const ENV_ON: Readonly<Record<string, string | undefined>> = Object.freeze({
  PROVIDER_RUNTIME_ENABLED: "true",
  PROVIDER_API_KEY: SECRET_KEY,
  PROVIDER_BASE_URL: "https://api.deepseek.test",
  PROVIDER_MODEL: "deepseek-chat",
});

const REQUEST: ProviderGenerateArticleContentRequest = {
  projectId: "proj_acme_main_site",
  articleBriefId: "brief_0001",
  model: "deepseek-chat",
  maxTokens: 1024,
  timeoutMs: 30_000,
  requestId: "req_0001",
  idempotencyKey: "idem_0001",
};

const GOOD_CONTENT = {
  schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
  title: "How ACME cut deploy time in half",
  summary: "A concise, governance-free summary of the article body.",
  sections: [
    { heading: "Background", body: "The first body paragraph of the draft." },
    { heading: "Approach", body: "The second body paragraph of the draft." },
  ],
};

interface Descriptor {
  readonly status: number;
  readonly body?: unknown;
  /** Raw string body (e.g. deliberately-malformed JSON). Overrides `body`. */
  readonly raw?: string;
}

interface RecordedCall {
  readonly url: string;
  readonly body: unknown;
}

/** Build an OpenAI/DeepSeek-style completion envelope. */
function envelope(
  content: string,
  finishReason: string = "stop",
  usage: Record<string, number> = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: finishReason },
    ],
    usage,
  };
}

const GOOD_ENVELOPE = envelope(JSON.stringify(GOOD_CONTENT), "stop", {
  prompt_tokens: 120,
  completion_tokens: 340,
  total_tokens: 460,
});

function toResponse(desc: Descriptor): Response {
  const payload = desc.raw !== undefined ? desc.raw : JSON.stringify(desc.body ?? {});
  return new Response(payload, {
    status: desc.status,
    headers: { "content-type": "application/json" },
  });
}

function recordCall(calls: RecordedCall[], input: string | URL | Request, init?: RequestInit): void {
  const url = typeof input === "string" ? input : input.toString();
  let body: unknown = undefined;
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  calls.push({ url, body });
}

/** A fake fetch that returns a fresh Response per attempt from a descriptor list. */
function sequenceFetch(descriptors: readonly Descriptor[]): { fn: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn: FetchLike = async (input, init) => {
    const index = calls.length;
    recordCall(calls, input, init);
    const clamped = Math.min(index, descriptors.length - 1);
    const desc = descriptors[clamped];
    if (desc === undefined) throw new Error("sequenceFetch: no descriptor");
    return toResponse(desc);
  };
  return { fn, calls };
}

/** A fake fetch that rejects (models an unreachable host / transport failure). */
function rejectingFetch(error: Error): { fn: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn: FetchLike = async (input, init) => {
    recordCall(calls, input, init);
    throw error;
  };
  return { fn, calls };
}

/** A fake fetch that never resolves on its own — it rejects only when aborted. */
function hangingFetch(): { fn: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn: FetchLike = (input, init) =>
    new Promise<Response>((_resolve, reject) => {
      recordCall(calls, input, init);
      const signal = init?.signal;
      const abort = (): void => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
    });
  return { fn, calls };
}

interface CapturedObserver {
  readonly observer: ProviderCallObserver;
  readonly executions: ProviderExecutionRecord[];
  readonly usages: ProviderUsageRecord[];
  readonly failures: ProviderFailureRecord[];
}

function captureObserver(): CapturedObserver {
  const executions: ProviderExecutionRecord[] = [];
  const usages: ProviderUsageRecord[] = [];
  const failures: ProviderFailureRecord[] = [];
  return {
    observer: {
      onExecution: (record) => executions.push(record),
      onUsage: (record) => usages.push(record),
      onFailure: (record) => failures.push(record),
    },
    executions,
    usages,
    failures,
  };
}

function requireFirst<T>(items: readonly T[]): T {
  const first = items[0];
  if (first === undefined) throw new Error("expected at least one item");
  return first;
}

// ---------------------------------------------------------------------------
// Suite-wide guard: ZERO real network calls
// ---------------------------------------------------------------------------

let globalFetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  globalFetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("no real network call is permitted in this suite"));
});

afterEach(() => {
  // Every test injects its own fetch; the real global must never be reached.
  expect(globalFetchSpy).not.toHaveBeenCalled();
  globalFetchSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — good completion", () => {
  it("returns validated Stage-1 content, a usage record, and 0 governance", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const captured = captureObserver();
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: ENV_ON,
      observer: captured.observer,
    });

    const result = await adapter.generateArticleContent(REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.content.schemaVersion).toBe(PROVIDER_ARTICLE_CONTENT_V1);
    expect(result.content.title).toBe(GOOD_CONTENT.title);
    expect(result.content.sections).toHaveLength(2);
    // Re-validating the content must still pass the firewall (0 governance).
    expect(validateProviderContent(result.content).ok).toBe(true);

    // Exactly one network attempt.
    expect(calls).toHaveLength(1);
    expect(requireFirst(calls).url).toBe("https://api.deepseek.test/v1/chat/completions");

    // Usage record carries the response's token counts.
    expect(captured.usages).toHaveLength(1);
    const usage = requireFirst(captured.usages);
    expect(usage.promptTokens).toBe(120);
    expect(usage.completionTokens).toBe(340);
    expect(usage.totalTokens).toBe(460);
    expect(usage.model).toBe("deepseek-chat");
    expect(usage.latencyMs).toBeGreaterThanOrEqual(0);

    // Execution record is OK, embeds the usage, and has no error code.
    expect(captured.executions).toHaveLength(1);
    const execution = requireFirst(captured.executions);
    expect(execution.outcome).toBe("OK");
    expect(execution.errorCode).toBeNull();
    expect(execution.usage).toEqual(usage);

    // No failure record on success.
    expect(captured.failures).toHaveLength(0);
  });

  it("sends the request model verbatim and a JSON-object response_format", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({ fetch: fn, env: ENV_ON });

    await adapter.generateArticleContent(REQUEST);

    const body = requireFirst(calls).body as Record<string, unknown>;
    expect(body.model).toBe("deepseek-chat");
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});

// ---------------------------------------------------------------------------
// Error taxonomy mapping
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — error taxonomy mapping", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly descriptors: readonly Descriptor[];
    readonly expected: ProviderErrorCode;
    readonly expectedCalls: number;
  }> = [
    {
      name: "401 -> PROVIDER_AUTH_FAILED",
      descriptors: [{ status: 401, body: { error: { message: "bad key" } } }],
      expected: ProviderErrorCode.PROVIDER_AUTH_FAILED,
      expectedCalls: 1,
    },
    {
      name: "403 -> PROVIDER_AUTH_FAILED",
      descriptors: [{ status: 403 }],
      expected: ProviderErrorCode.PROVIDER_AUTH_FAILED,
      expectedCalls: 1,
    },
    {
      name: "5xx -> PROVIDER_UNAVAILABLE (retried once)",
      descriptors: [{ status: 500 }, { status: 503 }],
      expected: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      expectedCalls: 2,
    },
    {
      name: "empty choices -> PROVIDER_EMPTY_RESPONSE",
      descriptors: [{ status: 200, body: { id: "x", choices: [], usage: {} } }],
      expected: ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
      expectedCalls: 1,
    },
    {
      name: "empty content string -> PROVIDER_EMPTY_RESPONSE",
      descriptors: [{ status: 200, body: envelope("") }],
      expected: ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
      expectedCalls: 1,
    },
    {
      name: "malformed HTTP body -> PROVIDER_EMPTY_RESPONSE",
      descriptors: [{ status: 200, raw: "this is not json {{{" }],
      expected: ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
      expectedCalls: 1,
    },
    {
      name: "finish_reason length -> PROVIDER_TOKEN_LIMIT",
      descriptors: [{ status: 200, body: envelope("partial...", "length") }],
      expected: ProviderErrorCode.PROVIDER_TOKEN_LIMIT,
      expectedCalls: 1,
    },
    {
      name: "context_length error -> PROVIDER_TOKEN_LIMIT",
      descriptors: [
        { status: 400, body: { error: { code: "context_length_exceeded", message: "too long" } } },
      ],
      expected: ProviderErrorCode.PROVIDER_TOKEN_LIMIT,
      expectedCalls: 1,
    },
    {
      name: "governance-laden content -> PROVIDER_CONTRACT_INVALID",
      descriptors: [
        {
          status: 200,
          body: envelope(
            JSON.stringify({
              schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
              title: "t",
              summary: "s",
              sections: [{ heading: "h", body: "b" }],
              gateStatus: "PASSED",
            }),
          ),
        },
      ],
      expected: ProviderErrorCode.PROVIDER_CONTRACT_INVALID,
      expectedCalls: 1,
    },
    {
      name: "off-shape content -> PROVIDER_CONTRACT_INVALID",
      descriptors: [{ status: 200, body: envelope(JSON.stringify({ foo: "bar" })) }],
      expected: ProviderErrorCode.PROVIDER_CONTRACT_INVALID,
      expectedCalls: 1,
    },
    {
      name: "non-JSON content -> PROVIDER_CONTRACT_INVALID",
      descriptors: [{ status: 200, body: envelope("Just some prose, not JSON at all.") }],
      expected: ProviderErrorCode.PROVIDER_CONTRACT_INVALID,
      expectedCalls: 1,
    },
    {
      name: "unexpected 4xx -> PROVIDER_CONTRACT_INVALID",
      descriptors: [{ status: 422, body: { error: { message: "unprocessable" } } }],
      expected: ProviderErrorCode.PROVIDER_CONTRACT_INVALID,
      expectedCalls: 1,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const { fn, calls } = sequenceFetch(testCase.descriptors);
      const captured = captureObserver();
      const adapter = new OpenAICompatibleProviderAdapter({
        fetch: fn,
        env: ENV_ON,
        observer: captured.observer,
      });

      const result = await adapter.generateArticleContent(REQUEST);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error result");
      expect(result.error).toBe(testCase.expected);
      expect(calls).toHaveLength(testCase.expectedCalls);

      // A failure emits both an ERROR execution record and a failure record.
      expect(captured.failures).toHaveLength(1);
      expect(requireFirst(captured.failures).errorCode).toBe(testCase.expected);
      expect(captured.usages).toHaveLength(0);
      const execution = requireFirst(captured.executions);
      expect(execution.outcome).toBe("ERROR");
      expect(execution.errorCode).toBe(testCase.expected);
      expect(execution.usage).toBeNull();
    });
  }

  it("maps an unreachable host (transport throw) to PROVIDER_UNAVAILABLE without retrying", async () => {
    const { fn, calls } = rejectingFetch(new TypeError("fetch failed"));
    const adapter = new OpenAICompatibleProviderAdapter({ fetch: fn, env: ENV_ON });

    const result = await adapter.generateArticleContent(REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(calls).toHaveLength(1); // transport errors are not retried
  });
});

// ---------------------------------------------------------------------------
// Timeout (single AbortController)
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — timeout", () => {
  it("aborts within the timeout budget and maps to PROVIDER_TIMEOUT", async () => {
    const { fn, calls } = hangingFetch();
    const adapter = new OpenAICompatibleProviderAdapter({ fetch: fn, env: ENV_ON });
    const request = { ...REQUEST, timeoutMs: 40 };

    const startedAt = Date.now();
    const result = await adapter.generateArticleContent(request);
    const elapsed = Date.now() - startedAt;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toBe(ProviderErrorCode.PROVIDER_TIMEOUT);
    expect(calls).toHaveLength(1); // a timeout is not retried
    // The hanging fetch never resolves; only the AbortController freed us.
    expect(elapsed).toBeLessThan(2_000);
  });

  it("clamps the timeout budget to the configured ceiling", async () => {
    const { fn } = hangingFetch();
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: ENV_ON,
      timeoutMsCeiling: 30,
    });
    // Request asks for a huge timeout; the ceiling must win and abort fast.
    const request = { ...REQUEST, timeoutMs: 10_000_000 };

    const startedAt = Date.now();
    const result = await adapter.generateArticleContent(request);
    const elapsed = Date.now() - startedAt;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toBe(ProviderErrorCode.PROVIDER_TIMEOUT);
    expect(elapsed).toBeLessThan(2_000);
  });
});

// ---------------------------------------------------------------------------
// Retry (max one, retryable class only)
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — retry policy", () => {
  it("retries a 429 exactly once, then gives up with PROVIDER_RATE_LIMIT", async () => {
    const { fn, calls } = sequenceFetch([{ status: 429 }, { status: 429 }, { status: 429 }]);
    const adapter = new OpenAICompatibleProviderAdapter({ fetch: fn, env: ENV_ON });

    const result = await adapter.generateArticleContent(REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toBe(ProviderErrorCode.PROVIDER_RATE_LIMIT);
    // Exactly two attempts: the original + one retry. Never a third.
    expect(calls).toHaveLength(2);
  });

  it("recovers when the single retry succeeds after a 429", async () => {
    const { fn, calls } = sequenceFetch([{ status: 429 }, { status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({ fetch: fn, env: ENV_ON });

    const result = await adapter.generateArticleContent(REQUEST);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Flag gate
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — flag gate", () => {
  it("refuses (PROVIDER_UNAVAILABLE) when PROVIDER_RUNTIME_ENABLED is false, never touching the network", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: { ...ENV_ON, PROVIDER_RUNTIME_ENABLED: "false" },
    });

    const result = await adapter.generateArticleContent(REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(calls).toHaveLength(0);
  });

  it("refuses when the flag is unset entirely", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: { PROVIDER_API_KEY: SECRET_KEY }, // no PROVIDER_RUNTIME_ENABLED
    });

    const result = await adapter.generateArticleContent(REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Model allow-list + token cap
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — model allow-list", () => {
  it("never auto-switches: a model outside the allowed set is rejected without a network call", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({ fetch: fn, env: ENV_ON });
    const request = { ...REQUEST, model: "gpt-4o-unknown-model" };

    const result = await adapter.generateArticleContent(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toBe(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
    expect(calls).toHaveLength(0);
    // The default allow-list is the DeepSeek-compatible set (sanity check).
    expect(DEFAULT_ALLOWED_MODELS).toContain("deepseek-chat");
  });

  it("accepts a model supplied via an explicit allowedModels option", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: { PROVIDER_RUNTIME_ENABLED: "true", PROVIDER_API_KEY: SECRET_KEY },
      allowedModels: ["custom-model-x"],
    });
    const request = { ...REQUEST, model: "custom-model-x" };

    const result = await adapter.generateArticleContent(request);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect((requireFirst(calls).body as Record<string, unknown>).model).toBe("custom-model-x");
  });
});

describe("OpenAICompatibleProviderAdapter — single max-token cap", () => {
  it("clamps max_tokens to the ceiling when the request asks for more", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: ENV_ON,
      maxTokensCeiling: 500,
    });
    const request = { ...REQUEST, maxTokens: 10_000_000 };

    await adapter.generateArticleContent(request);

    expect((requireFirst(calls).body as Record<string, unknown>).max_tokens).toBe(500);
  });

  it("passes a request under the ceiling through unchanged", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: ENV_ON,
      maxTokensCeiling: 500,
    });
    const request = { ...REQUEST, maxTokens: 128 };

    await adapter.generateArticleContent(request);

    expect((requireFirst(calls).body as Record<string, unknown>).max_tokens).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// Missing credential
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — missing credential", () => {
  it("maps a missing API key to PROVIDER_AUTH_FAILED without a network call", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: { PROVIDER_RUNTIME_ENABLED: "true" }, // no key at all
    });

    const result = await adapter.generateArticleContent(REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toBe(ProviderErrorCode.PROVIDER_AUTH_FAILED);
    expect(calls).toHaveLength(0);
  });

  it("falls back to DEEPSEEK_API_KEY when PROVIDER_API_KEY is absent", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: {
        PROVIDER_RUNTIME_ENABLED: "true",
        DEEPSEEK_API_KEY: SECRET_KEY,
        PROVIDER_MODEL: "deepseek-chat",
      },
    });

    const result = await adapter.generateArticleContent(REQUEST);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Secret hygiene: the API key never appears in a record, result, or console
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — the API key never leaks", () => {
  it("is absent from every record, result, and console line across success and failure", async () => {
    const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
    const consoleSpies = consoleMethods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    try {
      const captured = captureObserver();

      // A success run...
      const success = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
      const okAdapter = new OpenAICompatibleProviderAdapter({
        fetch: success.fn,
        env: ENV_ON,
        observer: captured.observer,
      });
      const okResult = await okAdapter.generateArticleContent(REQUEST);

      // ...and a failure run, both with the secret key present in the env.
      const failure = sequenceFetch([{ status: 401, body: { error: { message: "bad key" } } }]);
      const errAdapter = new OpenAICompatibleProviderAdapter({
        fetch: failure.fn,
        env: ENV_ON,
        observer: captured.observer,
      });
      const errResult = await errAdapter.generateArticleContent(REQUEST);

      // Records must never carry the key (nor an authorization/bearer field).
      const recordsBlob = JSON.stringify({
        executions: captured.executions,
        usages: captured.usages,
        failures: captured.failures,
      });
      expect(recordsBlob).not.toContain(SECRET_KEY);
      expect(recordsBlob.toLowerCase()).not.toContain("authorization");
      expect(recordsBlob.toLowerCase()).not.toContain("bearer");

      // The returned results must never carry the key either.
      expect(JSON.stringify(okResult)).not.toContain(SECRET_KEY);
      expect(JSON.stringify(errResult)).not.toContain(SECRET_KEY);

      // Nothing the adapter did was logged with the key.
      const consoleBlob = consoleSpies
        .flatMap((spy) => spy.mock.calls.flat())
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");
      expect(consoleBlob).not.toContain(SECRET_KEY);
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Canonical provider identity (PROVIDER_IDENTITY_LEDGER_V1)
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — canonical provider identity", () => {
  it("stamps the default identity (ALIYUN_MAAS / DEEPSEEK / OPENAI_COMPATIBLE) on success records", async () => {
    const { fn } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const captured = captureObserver();
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: ENV_ON,
      observer: captured.observer,
    });

    const result = await adapter.generateArticleContent(REQUEST);
    expect(result.ok).toBe(true);

    const execution = requireFirst(captured.executions);
    expect(execution.identity).toEqual(DEFAULT_PROVIDER_IDENTITY);
    expect(execution.identity.gatewayVendor).toBe("ALIYUN_MAAS");
    expect(execution.identity.modelVendor).toBe("DEEPSEEK");
    expect(execution.identity.protocol).toBe("OPENAI_COMPATIBLE");
  });

  it("stamps the identity on failure records too", async () => {
    const { fn } = sequenceFetch([{ status: 401, body: { error: { message: "bad key" } } }]);
    const captured = captureObserver();
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: ENV_ON,
      observer: captured.observer,
    });

    const result = await adapter.generateArticleContent(REQUEST);
    expect(result.ok).toBe(false);

    const execution = requireFirst(captured.executions);
    expect(execution.outcome).toBe("ERROR");
    expect(execution.identity).toEqual(DEFAULT_PROVIDER_IDENTITY);
  });

  it("carries a DECLARED identity verbatim — never derived from the base URL", async () => {
    const { fn, calls } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const captured = captureObserver();
    // The base URL says "deepseek", but the DECLARED identity is a custom
    // OpenAI-compatible gateway fronting an OTHER-vendor model. The record must
    // carry the declaration, proving no URL sniffing decides identity.
    const declared: ProviderIdentity = {
      gatewayVendor: "CUSTOM_OPENAI_COMPATIBLE",
      modelVendor: "OTHER",
      protocol: "OPENAI_COMPATIBLE",
    };
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: ENV_ON, // PROVIDER_BASE_URL=https://api.deepseek.test
      identity: declared,
      observer: captured.observer,
    });

    const result = await adapter.generateArticleContent(REQUEST);
    expect(result.ok).toBe(true);
    expect(requireFirst(calls).url).toBe("https://api.deepseek.test/v1/chat/completions");
    expect(requireFirst(captured.executions).identity).toEqual(declared);
  });

  it("rejects the backfill-only 'UNKNOWN_LEGACY' gateway at construction", () => {
    expect(
      () =>
        new OpenAICompatibleProviderAdapter({
          identity: {
            gatewayVendor: "UNKNOWN_LEGACY",
            modelVendor: "DEEPSEEK",
            protocol: "OPENAI_COMPATIBLE",
          },
        }),
    ).toThrow(/UNKNOWN_LEGACY/);
  });

  it("record shapes have NO field for an api key, base URL, workspace id, prompt, or response", async () => {
    const { fn } = sequenceFetch([{ status: 200, body: GOOD_ENVELOPE }]);
    const captured = captureObserver();
    const adapter = new OpenAICompatibleProviderAdapter({
      fetch: fn,
      env: ENV_ON,
      observer: captured.observer,
    });
    await adapter.generateArticleContent(REQUEST);

    const execution = requireFirst(captured.executions);
    // Exact, whitelisted key set — an extra field (a leaked secret/endpoint/
    // content field) would break this equality.
    expect(Object.keys(execution).sort()).toEqual(
      [
        "articleBriefId",
        "errorCode",
        "identity",
        "idempotencyKey",
        "latencyMs",
        "model",
        "outcome",
        "projectId",
        "requestId",
        "usage",
      ].sort(),
    );
    expect(Object.keys(execution.identity).sort()).toEqual(
      ["gatewayVendor", "modelVendor", "protocol"].sort(),
    );
    expect(Object.keys(requireFirst(captured.usages)).sort()).toEqual(
      [
        "completionTokens",
        "idempotencyKey",
        "latencyMs",
        "model",
        "promptTokens",
        "requestId",
        "totalTokens",
      ].sort(),
    );

    // Defense in depth: none of these forbidden names appear anywhere in any
    // emitted record (nested keys included).
    const blob = JSON.stringify({
      executions: captured.executions,
      usages: captured.usages,
      failures: captured.failures,
    }).toLowerCase();
    for (const forbidden of [
      "apikey",
      "api_key",
      "authorization",
      "bearer",
      "baseurl",
      "base_url",
      "endpoint",
      "host",
      "workspace",
      "prompt\":",
      "response\":",
    ]) {
      expect(blob).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// No SDK / network dependency in the source
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProviderAdapter — no SDK dependency", () => {
  it("imports only within the provider lane; no OpenAI/anthropic/http SDK", () => {
    const source = readFileSync(
      new URL("../../../src/runtime/provider/openai-compatible-adapter.ts", import.meta.url),
      "utf8",
    );
    const specifiers = [
      ...source.matchAll(/^\s*import[^"']*from\s*["']([^"']+)["']/gm),
      ...source.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1] ?? "");

    const forbidden =
      /\b(node-fetch|undici|axios|got|superagent|openai|anthropic|@anthropic-ai|@openai|langchain|grpc|ws|websocket)\b/i;
    for (const specifier of specifiers) {
      expect(forbidden.test(specifier)).toBe(false);
      // Every import resolves within this lane (relative ./ path).
      expect(specifier.startsWith("./")).toBe(true);
    }
  });
});
