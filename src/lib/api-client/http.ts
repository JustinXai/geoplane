/**
 * FRONTEND_API_CLIENT_V1 — typed fetch wrapper over the FROZEN response envelope.
 *
 * Owned by Agent F (src/lib/api-client/**). Imports the frozen contract from
 * src/runtime/api-contracts/index.ts only; invents no parallel DTOs.
 *
 * Contract:
 *  - Parses every response as ApiResponseV1<T> and returns a discriminated Result:
 *      { ok: true, data: T } | { ok: false, code, message, details? }
 *  - Expected API errors (a well-formed error envelope) are RETURNED as the error
 *    variant with their distinct ApiErrorCodeV1 — never thrown.
 *  - A non-2xx response WITHOUT a well-formed envelope is mapped to INTERNAL_ERROR.
 *  - Thrown ApiClientError is reserved for network failure (fetch rejects / body
 *    unreadable) and for a 2xx response whose body is not a well-formed envelope
 *    (a genuine parse failure of an expected success).
 */
import {
  API_ERROR_HTTP_STATUS,
  type ApiErrorCodeV1,
  type ApiResponseV1,
} from "../../runtime/api-contracts/index.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Discriminated outcome of an API call. Never throws for expected API errors. */
export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: ApiErrorCodeV1;
      readonly message: string;
      readonly details?: Record<string, unknown>;
    };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err<T = never>(
  code: ApiErrorCodeV1,
  message: string,
  details?: Record<string, unknown>,
): Result<T> {
  return details ? { ok: false, code, message, details } : { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// Thrown-error type (network / parse failure only)
// ---------------------------------------------------------------------------

export type ApiClientErrorKind = "NETWORK" | "PARSE";

/** Thrown only for transport/parse failures — never for an expected API error. */
export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind;
  override readonly cause?: unknown;

  constructor(kind: ApiClientErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.kind = kind;
    this.cause = cause;
    // Preserve prototype chain across the ES2022 transpile target.
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Injectable fetch surface (minimal — a real Response satisfies it structurally)
// ---------------------------------------------------------------------------

export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<HttpResponseLike>;

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface HttpRequestOptions {
  readonly method?: HttpMethod;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export interface HttpClientConfig {
  /** Injectable fetch; defaults to globalThis.fetch (resolved lazily at call time). */
  readonly fetch?: FetchLike;
  /** Prefixed onto every request path. Defaults to "" (relative — works in the browser). */
  readonly baseUrl?: string;
}

export interface ApiClient {
  request<T>(path: string, options?: HttpRequestOptions): Promise<Result<T>>;
}

// ---------------------------------------------------------------------------
// Envelope coercion
// ---------------------------------------------------------------------------

function isApiErrorCode(value: unknown): value is ApiErrorCodeV1 {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(API_ERROR_HTTP_STATUS, value);
}

/** Returns the envelope only when the body is a well-formed ApiResponseV1; otherwise null. */
function coerceEnvelope(parsed: unknown): ApiResponseV1<unknown> | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.ok === true) {
    if (!("data" in obj)) return null;
    return { ok: true, data: obj.data };
  }

  if (obj.ok === false) {
    const error = obj.error;
    if (typeof error !== "object" || error === null) return null;
    const e = error as Record<string, unknown>;
    if (!isApiErrorCode(e.code)) return null;
    if (typeof e.message !== "string") return null;
    const details = e.details;
    if (details !== undefined && (typeof details !== "object" || details === null)) return null;
    return {
      ok: false,
      error: {
        code: e.code,
        message: e.message,
        ...(details !== undefined ? { details: details as Record<string, unknown> } : {}),
      },
    };
  }

  return null;
}

function toResult<T>(envelope: ApiResponseV1<unknown>): Result<T> {
  if (envelope.ok) return { ok: true, data: envelope.data as T };
  return envelope.error.details !== undefined
    ? { ok: false, code: envelope.error.code, message: envelope.error.message, details: envelope.error.details }
    : { ok: false, code: envelope.error.code, message: envelope.error.message };
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createApiClient(config: HttpClientConfig = {}): ApiClient {
  const baseUrl = config.baseUrl ?? "";
  const fetchImpl: FetchLike =
    config.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(path: string, options: HttpRequestOptions = {}): Promise<Result<T>> {
    const method: HttpMethod = options.method ?? "GET";
    const hasBody = options.body !== undefined;

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    };

    const init: RequestInit = {
      method,
      headers,
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    };

    let response: HttpResponseLike;
    try {
      response = await fetchImpl(baseUrl + path, init);
    } catch (cause) {
      throw new ApiClientError(
        "NETWORK",
        `Network request to ${method} ${path} failed`,
        cause,
      );
    }

    let rawText: string;
    try {
      rawText = await response.text();
    } catch (cause) {
      throw new ApiClientError(
        "NETWORK",
        `Failed to read the response body from ${method} ${path}`,
        cause,
      );
    }

    let parsed: unknown;
    let parseFailed = false;
    if (rawText.length === 0) {
      parsed = undefined;
    } else {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parseFailed = true;
      }
    }

    const envelope = parseFailed ? null : coerceEnvelope(parsed);
    if (envelope) return toResult<T>(envelope);

    // No well-formed envelope.
    if (!response.ok) {
      // Non-2xx without a usable envelope -> map to INTERNAL_ERROR (do not throw).
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        message: `Request to ${method} ${path} failed with status ${response.status}`,
      };
    }

    // 2xx but the body is not a well-formed envelope -> a genuine parse failure.
    throw new ApiClientError(
      "PARSE",
      `Expected an ApiResponseV1 envelope from ${method} ${path} but the body was malformed (status ${response.status})`,
    );
  }

  return { request };
}

/** Default client bound to the ambient fetch and relative paths. */
export const defaultApiClient: ApiClient = createApiClient();
