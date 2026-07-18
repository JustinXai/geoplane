/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: OPENAI_COMPATIBLE_ADAPTER_V1 (checkpoint D2 of the
 *   controlled-provider lane) — the real, network-shaped ProviderPort
 *   implementation for a DeepSeek/OpenAI-compatible /v1/chat/completions API.
 *   Built on the D1 boundary (provider-port / errors / records / feature-flag /
 *   contract-validation); adds NO dependency — it uses the built-in global
 *   `fetch` (Node 22), never an OpenAI SDK.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * WHAT THIS ADAPTER IS ALLOWED TO DO, AND WHAT IT IS NOT
 * -----------------------------------------------------
 * It asks a language model for Stage-1 user-visible article content and nothing
 * else. Its return type (`ProviderResult` -> `ProviderArticleContentV1`)
 * structurally forbids governance; and every completion is additionally forced
 * through `validateProviderContent` (the governance firewall) before it can
 * become content, so a model that tries to smuggle a gate/approval/publication
 * verdict is rejected as PROVIDER_CONTRACT_INVALID.
 *
 * SAFETY LIMITS BAKED IN (see PILOT spec D2):
 *   - FLAG-GATED: refuses (PROVIDER_UNAVAILABLE) unless the runtime flag is on —
 *     `assertRealProviderCallAllowed` is called before any network I/O.
 *   - SINGLE TOKEN CAP: `max_tokens` sent to the provider is clamped to a single
 *     ceiling, so a caller can never request an unbounded completion.
 *   - SINGLE TIMEOUT: one AbortController per attempt, budget = request.timeoutMs
 *     (clamped to a ceiling); an abort maps to PROVIDER_TIMEOUT.
 *   - MAX ONE RETRY: only on a retryable class (429 / 5xx); one retry then give
 *     up. Never infinite, never a concurrency storm — attempts are sequential
 *     (at most two requests per call, awaited one at a time).
 *   - NEVER AUTO-SWITCH MODEL: a model not in the allowed set is rejected; the
 *     request's model is sent verbatim, never silently substituted.
 *
 * NO SECRETS, EVER. The API key is read from the environment lazily at call time
 * into a local variable, used only to build the Authorization header, and is
 * NEVER assigned to an instance field, a record, a log line, or an error
 * message. The observability records (records.ts) have nowhere to put a secret
 * by construction. This adapter performs no logging at all.
 */
import {
  providerErr,
  providerOk,
  validateProviderGenerateRequest,
  type ProviderArticleContentV1,
  type ProviderGenerateArticleContentRequest,
  type ProviderPort,
  type ProviderResult,
} from "./provider-port.js";
import { validateProviderContent } from "./contract-validation.js";
import { ProviderErrorCode } from "./errors.js";
import { assertRealProviderCallAllowed } from "./feature-flag.js";
import {
  buildProviderFailureRecord,
  buildProviderSuccessRecord,
  buildProviderUsageRecord,
  type ProviderCallMetadata,
  type ProviderExecutionRecord,
  type ProviderFailureRecord,
  type ProviderUsageRecord,
} from "./records.js";

/** The built-in fetch shape (Node 22 global). No SDK, no dependency. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * A non-secret sink for the observability records this adapter emits. D3 (the
 * durable execution ledger) supplies a real implementation; tests supply a
 * capturing one. Every method is optional and defaults to a no-op. A record
 * NEVER carries a secret — see records.ts.
 */
export interface ProviderCallObserver {
  readonly onExecution?: (record: ProviderExecutionRecord) => void;
  readonly onUsage?: (record: ProviderUsageRecord) => void;
  readonly onFailure?: (record: ProviderFailureRecord) => void;
}

/** Environment variable names this adapter reads (never logs, never stores). */
export const PROVIDER_BASE_URL_ENV_VAR = "PROVIDER_BASE_URL" as const;
export const PROVIDER_MODEL_ENV_VAR = "PROVIDER_MODEL" as const;
export const PROVIDER_ALLOWED_MODELS_ENV_VAR = "PROVIDER_ALLOWED_MODELS" as const;
export const PROVIDER_API_KEY_ENV_VAR = "PROVIDER_API_KEY" as const;
export const DEEPSEEK_API_KEY_ENV_VAR = "DEEPSEEK_API_KEY" as const;
export const PROVIDER_MAX_TOKENS_ENV_VAR = "PROVIDER_MAX_TOKENS" as const;
export const PROVIDER_TIMEOUT_MS_ENV_VAR = "PROVIDER_TIMEOUT_MS" as const;

/** DeepSeek is OpenAI-compatible; this is the default base when none is set. */
export const DEFAULT_PROVIDER_BASE_URL = "https://api.deepseek.com" as const;

/** Default allow-list of DeepSeek/OpenAI-compatible models. */
export const DEFAULT_ALLOWED_MODELS: readonly string[] = Object.freeze([
  "deepseek-chat",
  "deepseek-reasoner",
]);

/** Absolute ceiling on `max_tokens` when none is configured. Single token cap. */
export const DEFAULT_MAX_TOKENS_CEILING = 4096 as const;

/** Absolute ceiling on the per-attempt timeout budget when none is configured. */
export const DEFAULT_TIMEOUT_MS_CEILING = 60_000 as const;

/** Exactly one retry is permitted, and only for a retryable class. Never infinite. */
export const MAX_RETRIES = 1 as const;

/**
 * The system prompt instructing the model to return ONLY Stage-1 content as a
 * JSON object. The governance firewall enforces this regardless of the prompt —
 * the prompt is a best-effort nudge, not the security boundary.
 */
const SYSTEM_PROMPT =
  "You produce ONLY user-visible article content as a strict JSON object with " +
  'the exact shape {"schemaVersion":"ProviderArticleContentV1","title":string,' +
  '"summary":string,"sections":[{"heading":string,"body":string}, ...]}. ' +
  "Return JSON only, no prose outside the object, and NEVER include any gate, " +
  "approval, review, publication, channel, evidence, or lifecycle status field.";

export interface OpenAICompatibleAdapterOptions {
  /** Injected fetch so tests never hit the network. Defaults to global fetch. */
  readonly fetch?: FetchLike;
  /** Environment source. Defaults to process.env. Never copied field-by-field. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Explicit allow-list of models. When provided, it fully replaces the default
   * + env-derived set. A request whose model is not in the set is rejected.
   */
  readonly allowedModels?: readonly string[];
  /** Ceiling for `max_tokens`. Defaults to env PROVIDER_MAX_TOKENS, else 4096. */
  readonly maxTokensCeiling?: number;
  /** Ceiling for the timeout budget. Defaults to env PROVIDER_TIMEOUT_MS, else 60000. */
  readonly timeoutMsCeiling?: number;
  /** Non-secret record sink (D3 ledger / test capture). Defaults to no-op. */
  readonly observer?: ProviderCallObserver;
  /** Injectable clock for latency measurement. Defaults to Date.now. */
  readonly now?: () => number;
}

/** Internal per-call resolved config. The apiKey lives here transiently only. */
interface ResolvedConfig {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly allowedModels: ReadonlySet<string>;
  readonly maxTokensCeiling: number;
  readonly timeoutMsCeiling: number;
}

/** The outcome of one HTTP attempt: a completed response, or a transport error. */
type AttemptOutcome =
  | { readonly kind: "response"; readonly status: number; readonly body: unknown }
  | { readonly kind: "transport-error"; readonly timedOut: boolean };

/** A classified attempt: either a validated success payload or a taxonomy code. */
type ClassifiedOutcome =
  | {
      readonly ok: true;
      readonly content: ProviderArticleContentV1;
      readonly promptTokens: number;
      readonly completionTokens: number;
    }
  | { readonly ok: false; readonly error: ProviderErrorCode; readonly retryable: boolean };

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function nonEmptyTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Coerce an unknown token count into a non-negative integer (0 when absent/bad). */
function toNonNegativeInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
}

/**
 * Build the /v1/chat/completions endpoint from a base URL, tolerating trailing
 * slashes and a base that already includes a version or the full path.
 */
function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  if (/\/v\d+$/.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

/**
 * Detect a token-limit signal in a completion body: a `finish_reason` of
 * "length" (truncated), or an error object mentioning length/token/context.
 */
function hasTokenLimitSignal(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;

  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (typeof first === "object" && first !== null) {
      const finishReason = (first as Record<string, unknown>).finish_reason;
      if (finishReason === "length" || finishReason === "max_tokens") return true;
    }
  }

  const error = obj.error;
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;
    const haystack = [err.code, err.type, err.message]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .toLowerCase();
    if (/context[_ ]?length|max[_ ]?tokens|token limit|too many tokens/.test(haystack)) {
      return true;
    }
  }
  return false;
}

/** Extract the assistant message content string from a completion envelope. */
function extractMessageContent(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return undefined;
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : undefined;
}

/**
 * A DeepSeek/OpenAI-compatible ProviderPort adapter.
 *
 * Constructed with an injectable fetch (default: the built-in global fetch) so
 * tests are fully offline. All secret/config material is read from the injected
 * environment at call time; nothing secret is stored on the instance.
 */
export class OpenAICompatibleProviderAdapter implements ProviderPort {
  readonly #fetch: FetchLike | undefined;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #explicitAllowedModels: readonly string[] | undefined;
  readonly #maxTokensCeilingOverride: number | undefined;
  readonly #timeoutMsCeilingOverride: number | undefined;
  readonly #observer: ProviderCallObserver;
  readonly #now: () => number;

  constructor(options: OpenAICompatibleAdapterOptions = {}) {
    this.#fetch = options.fetch;
    this.#env = options.env ?? process.env;
    this.#explicitAllowedModels = options.allowedModels;
    this.#maxTokensCeilingOverride = options.maxTokensCeiling;
    this.#timeoutMsCeilingOverride = options.timeoutMsCeiling;
    this.#observer = options.observer ?? {};
    this.#now = options.now ?? Date.now;
  }

  async generateArticleContent(
    request: ProviderGenerateArticleContentRequest,
  ): Promise<ProviderResult> {
    const startedAt = this.#now();

    // 1. Runtime guard on the request shape. A malformed request can't form a
    //    trustworthy record, so it is refused without emitting one.
    const validated = validateProviderGenerateRequest(request);
    if (!validated.ok) {
      return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
    }
    const req = validated.request;

    // 2. FLAG GATE — refuse before any network I/O when the runtime is off.
    try {
      assertRealProviderCallAllowed(this.#env);
    } catch {
      return this.#finishError(req, startedAt, ProviderErrorCode.PROVIDER_UNAVAILABLE);
    }

    // 3. Resolve non-secret config + the transient key from the environment.
    const config = this.#resolveConfig();

    // 4. NEVER auto-switch to an unknown model — reject one not in the set.
    if (!config.allowedModels.has(req.model)) {
      return this.#finishError(req, startedAt, ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
    }

    // 5. A missing credential is an auth failure — never attempt the network.
    const apiKey = config.apiKey;
    if (apiKey === undefined) {
      return this.#finishError(req, startedAt, ProviderErrorCode.PROVIDER_AUTH_FAILED);
    }

    // 6. Build the request. SINGLE TOKEN CAP + SINGLE TIMEOUT applied here.
    const url = resolveChatCompletionsUrl(config.baseUrl);
    const effectiveMaxTokens = Math.min(req.maxTokens, config.maxTokensCeiling);
    const effectiveTimeoutMs = Math.min(req.timeoutMs, config.timeoutMsCeiling);
    const requestBody = JSON.stringify({
      model: req.model, // verbatim — never substituted
      max_tokens: effectiveMaxTokens,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Generate article content for brief ${req.articleBriefId} ` +
            `(project ${req.projectId}). Respond with the JSON object only.`,
        },
      ],
    });

    // 7. Execute with MAX ONE RETRY, sequentially (no concurrency storm).
    let classified = await this.#runAttempt(url, apiKey, requestBody, effectiveTimeoutMs);
    if (!classified.ok && classified.retryable) {
      // Exactly one retry for a retryable class (429 / 5xx). Then give up.
      classified = await this.#runAttempt(url, apiKey, requestBody, effectiveTimeoutMs);
    }

    if (!classified.ok) {
      return this.#finishError(req, startedAt, classified.error);
    }

    return this.#finishSuccess(req, startedAt, classified);
  }

  /** Read + resolve all config from the injected env. Key is transient here. */
  #resolveConfig(): ResolvedConfig {
    const baseUrl =
      nonEmptyTrimmed(this.#env[PROVIDER_BASE_URL_ENV_VAR]) ?? DEFAULT_PROVIDER_BASE_URL;

    const apiKey =
      nonEmptyTrimmed(this.#env[PROVIDER_API_KEY_ENV_VAR]) ??
      nonEmptyTrimmed(this.#env[DEEPSEEK_API_KEY_ENV_VAR]);

    const allowedModels = new Set<string>();
    if (this.#explicitAllowedModels !== undefined) {
      for (const model of this.#explicitAllowedModels) {
        const trimmed = nonEmptyTrimmed(model);
        if (trimmed !== undefined) allowedModels.add(trimmed);
      }
    } else {
      for (const model of DEFAULT_ALLOWED_MODELS) allowedModels.add(model);
      const configuredModel = nonEmptyTrimmed(this.#env[PROVIDER_MODEL_ENV_VAR]);
      if (configuredModel !== undefined) allowedModels.add(configuredModel);
      const allowedList = this.#env[PROVIDER_ALLOWED_MODELS_ENV_VAR];
      if (typeof allowedList === "string") {
        for (const model of allowedList.split(",")) {
          const trimmed = nonEmptyTrimmed(model);
          if (trimmed !== undefined) allowedModels.add(trimmed);
        }
      }
    }

    const maxTokensCeiling = this.#resolveCeiling(
      this.#maxTokensCeilingOverride,
      this.#env[PROVIDER_MAX_TOKENS_ENV_VAR],
      DEFAULT_MAX_TOKENS_CEILING,
    );
    const timeoutMsCeiling = this.#resolveCeiling(
      this.#timeoutMsCeilingOverride,
      this.#env[PROVIDER_TIMEOUT_MS_ENV_VAR],
      DEFAULT_TIMEOUT_MS_CEILING,
    );

    return { baseUrl, apiKey, allowedModels, maxTokensCeiling, timeoutMsCeiling };
  }

  #resolveCeiling(
    override: number | undefined,
    envValue: string | undefined,
    fallback: number,
  ): number {
    if (typeof override === "number" && Number.isInteger(override) && override > 0) {
      return override;
    }
    if (typeof envValue === "string") {
      const parsed = Number(envValue.trim());
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return fallback;
  }

  /** One HTTP attempt + classification into success or a taxonomy code. */
  async #runAttempt(
    url: string,
    apiKey: string,
    body: string,
    timeoutMs: number,
  ): Promise<ClassifiedOutcome> {
    const attempt = await this.#attemptOnce(url, apiKey, body, timeoutMs);
    return this.#classify(attempt);
  }

  /**
   * Perform a single POST with a SINGLE AbortController timeout. Returns a
   * completed response (status + parsed body) or a transport error flagged as
   * timed-out vs. unreachable. Never throws for an HTTP error status.
   */
  async #attemptOnce(
    url: string,
    apiKey: string,
    body: string,
    timeoutMs: number,
  ): Promise<AttemptOutcome> {
    const fetchImpl = this.#fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The ONLY place the key is used — a request header, never a record/log.
          authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null; // malformed / empty HTTP body
      }
      return { kind: "response", status: response.status, body: parsed };
    } catch (error) {
      const timedOut = controller.signal.aborted || isAbortError(error);
      return { kind: "transport-error", timedOut };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Map an attempt onto the taxonomy (or a validated success payload). */
  #classify(attempt: AttemptOutcome): ClassifiedOutcome {
    if (attempt.kind === "transport-error") {
      return attempt.timedOut
        ? { ok: false, error: ProviderErrorCode.PROVIDER_TIMEOUT, retryable: false }
        : { ok: false, error: ProviderErrorCode.PROVIDER_UNAVAILABLE, retryable: false };
    }

    const { status, body } = attempt;

    if (status === 401 || status === 403) {
      return { ok: false, error: ProviderErrorCode.PROVIDER_AUTH_FAILED, retryable: false };
    }
    if (status === 429) {
      return { ok: false, error: ProviderErrorCode.PROVIDER_RATE_LIMIT, retryable: true };
    }
    if (status >= 500) {
      return { ok: false, error: ProviderErrorCode.PROVIDER_UNAVAILABLE, retryable: true };
    }
    if (status < 200 || status >= 300) {
      // An unexpected 4xx: a token-limit signal maps to TOKEN_LIMIT, else the
      // request was rejected as off-contract.
      return hasTokenLimitSignal(body)
        ? { ok: false, error: ProviderErrorCode.PROVIDER_TOKEN_LIMIT, retryable: false }
        : { ok: false, error: ProviderErrorCode.PROVIDER_CONTRACT_INVALID, retryable: false };
    }

    // 2xx — a truncated (token-limited) completion is a TOKEN_LIMIT even at 200.
    if (hasTokenLimitSignal(body)) {
      return { ok: false, error: ProviderErrorCode.PROVIDER_TOKEN_LIMIT, retryable: false };
    }

    const content = extractMessageContent(body);
    if (content === undefined || content.trim() === "") {
      // No usable completion text — empty/malformed completion.
      return { ok: false, error: ProviderErrorCode.PROVIDER_EMPTY_RESPONSE, retryable: false };
    }

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      // Content present but not the required JSON object — off-shape.
      return { ok: false, error: ProviderErrorCode.PROVIDER_CONTRACT_INVALID, retryable: false };
    }

    // GOVERNANCE FIREWALL — the completion must be pure Stage-1 content.
    const validation = validateProviderContent(parsedContent);
    if (!validation.ok) {
      return { ok: false, error: validation.error, retryable: false };
    }

    const usage =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).usage
        : undefined;
    const usageObj =
      typeof usage === "object" && usage !== null ? (usage as Record<string, unknown>) : {};

    return {
      ok: true,
      content: validation.content,
      promptTokens: toNonNegativeInt(usageObj.prompt_tokens),
      completionTokens: toNonNegativeInt(usageObj.completion_tokens),
    };
  }

  #metaFor(
    req: ProviderGenerateArticleContentRequest,
    latencyMs: number,
  ): ProviderCallMetadata {
    return {
      requestId: req.requestId,
      idempotencyKey: req.idempotencyKey,
      projectId: req.projectId,
      articleBriefId: req.articleBriefId,
      model: req.model,
      latencyMs,
    };
  }

  #finishSuccess(
    req: ProviderGenerateArticleContentRequest,
    startedAt: number,
    payload: Extract<ClassifiedOutcome, { ok: true }>,
  ): ProviderResult {
    const meta = this.#metaFor(req, this.#elapsed(startedAt));
    const usageRecord = buildProviderUsageRecord(meta, {
      promptTokens: payload.promptTokens,
      completionTokens: payload.completionTokens,
    });
    const executionRecord = buildProviderSuccessRecord(meta, usageRecord);
    this.#observer.onUsage?.(usageRecord);
    this.#observer.onExecution?.(executionRecord);
    return providerOk(payload.content);
  }

  #finishError(
    req: ProviderGenerateArticleContentRequest,
    startedAt: number,
    error: ProviderErrorCode,
  ): ProviderResult {
    const meta = this.#metaFor(req, this.#elapsed(startedAt));
    const executionRecord = buildProviderFailureRecord(meta, error);
    const failureRecord: ProviderFailureRecord = {
      requestId: meta.requestId,
      idempotencyKey: meta.idempotencyKey,
      model: meta.model,
      errorCode: error,
      latencyMs: meta.latencyMs,
    };
    this.#observer.onExecution?.(executionRecord);
    this.#observer.onFailure?.(failureRecord);
    return providerErr(error);
  }

  #elapsed(startedAt: number): number {
    const delta = this.#now() - startedAt;
    return Number.isFinite(delta) && delta >= 0 ? delta : 0;
  }
}
