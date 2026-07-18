/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: PROVIDER_PORT_AND_CONTRACT_V1 (checkpoint D1) — the
 *   controlled-provider boundary. Consumer-defined port + request/response
 *   contract for "ask a language model for user-visible article content".
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * THE STRICT TWO-STAGE LAYERING THIS FILE PROTECTS
 * -----------------------------------------------
 * Stage 1 (this boundary): a language model may produce ONLY user-visible
 *   article content — `ProviderArticleContentV1` below (title, summary, and
 *   prose sections). Nothing else.
 * Stage 2 (the deterministic compiler, src/contracts/geo-business/entities.ts):
 *   governance is injected DETERMINISTICALLY by the compiler/gates/approval
 *   machinery — governance enums, gate conclusions, approval status, evidence
 *   hashes, and publication status. The model NEVER produces any of these.
 *
 * `ProviderArticleContentV1` is therefore intentionally distinct from the
 * frozen `ProviderArticleContent` *entity* in the contracts package: that
 * entity is a Stage-2 record carrying an opaque `providerResponseEnvelopeId`
 * pointer plus tenant/brief linkage that the compiler assigns. THIS type is the
 * Stage-1 payload shape a model is allowed to hand back — pure content, no ids
 * the compiler owns, no governance, no linkage. Keeping them separate is what
 * makes "the model cannot produce governance state" a structural property: the
 * model's return type simply has nowhere to put it.
 */
import { ProviderErrorCode } from "./errors.js";

/** Discriminant/version tag for the Stage-1 user-visible content shape. */
export const PROVIDER_ARTICLE_CONTENT_V1 = "ProviderArticleContentV1" as const;

/**
 * One user-visible section of model-produced article content. Prose only —
 * `heading` and `body` are plain text meant for a human reader. There is no
 * field here (and no way to add one without editing this type) for a gate
 * verdict, an approval flag, an evidence hash, a channel, or a lifecycle
 * status.
 */
export interface ProviderArticleContentSectionV1 {
  readonly heading: string;
  readonly body: string;
}

/**
 * Stage-1 user-visible article content — the ONLY thing a provider (language
 * model) is permitted to produce. A non-empty tuple of prose sections plus a
 * title and summary. Carries no tenant ids, no brief id, no envelope pointer,
 * and — critically — no governance state of any kind. Those are all injected
 * downstream, deterministically, by Stage 2.
 */
export interface ProviderArticleContentV1 {
  readonly schemaVersion: typeof PROVIDER_ARTICLE_CONTENT_V1;
  readonly title: string;
  readonly summary: string;
  /** Non-empty (tuple-with-rest): content with zero sections is not valid. */
  readonly sections: readonly [
    ProviderArticleContentSectionV1,
    ...ProviderArticleContentSectionV1[],
  ];
}

/**
 * A request to generate user-visible article content for one ArticleBrief.
 * EVERY field is required and typed — there is no partial/optional variant, so
 * a caller cannot construct a request that omits tenancy scope, model
 * selection, budget, or the correlation/idempotency identifiers. (A runtime
 * guard, `validateProviderGenerateRequest` below, re-checks the same fields at
 * the boundary where a value arrives from outside static typing.)
 *
 * Note there is deliberately NO `apiKey` / credential field here: secrets are
 * an adapter-construction concern (D2), never part of the request contract, so
 * a request value can be logged/recorded without ever leaking a key.
 */
export interface ProviderGenerateArticleContentRequest {
  /** Tenant/project scope the resulting content belongs to. */
  readonly projectId: string;
  /** The ArticleBrief this content is generated for. */
  readonly articleBriefId: string;
  /** Model identifier (e.g. an OpenAI-compatible model name). */
  readonly model: string;
  /** Hard cap on tokens for this call. Must be a positive integer. */
  readonly maxTokens: number;
  /** Timeout budget in milliseconds. Must be a positive integer. */
  readonly timeoutMs: number;
  /** Correlation id for this specific call (tracing/ledger). */
  readonly requestId: string;
  /** Idempotency key — same key must map to the same logical call. */
  readonly idempotencyKey: string;
}

/**
 * The result of a provider call: a discriminated union of success (carrying
 * validated Stage-1 content) and failure (carrying exactly one taxonomy code).
 * There is no third "partial"/"maybe" shape and no free-text error — a caller
 * can exhaustively narrow on `ok`.
 */
export type ProviderResult =
  | { readonly ok: true; readonly content: ProviderArticleContentV1 }
  | { readonly ok: false; readonly error: ProviderErrorCode };

/** Construct a success result. */
export function providerOk(content: ProviderArticleContentV1): ProviderResult {
  return { ok: true, content };
}

/** Construct a failure result carrying one taxonomy code. */
export function providerErr(error: ProviderErrorCode): ProviderResult {
  return { ok: false, error };
}

/**
 * The controlled-provider boundary. The ONLY method through which the system
 * asks a language model for content. Its return type (`ProviderResult` ->
 * `ProviderArticleContentV1`) structurally forbids the model from returning
 * governance state.
 *
 * Implementations this checkpoint: `DeterministicOfflineProviderAdapter`
 * (offline, no network — the default while the feature flag is off). The real
 * OpenAI-compatible adapter is D2.
 */
export interface ProviderPort {
  generateArticleContent(
    request: ProviderGenerateArticleContentRequest,
  ): Promise<ProviderResult>;
}

/**
 * The mandated request fields, in one place, so the runtime guard and any test
 * enumerating "what a request must carry" share a single source of truth.
 */
export const REQUIRED_PROVIDER_REQUEST_FIELDS = Object.freeze([
  "projectId",
  "articleBriefId",
  "model",
  "maxTokens",
  "timeoutMs",
  "requestId",
  "idempotencyKey",
] as const);

/**
 * Runtime validation result for a provider request. Mirrors `ProviderResult`'s
 * discriminated shape; a malformed request is a `PROVIDER_CONTRACT_INVALID`.
 */
export type ProviderRequestValidation =
  | { readonly ok: true; readonly request: ProviderGenerateArticleContentRequest }
  | {
      readonly ok: false;
      readonly error: ProviderErrorCode.PROVIDER_CONTRACT_INVALID;
      readonly invalidFields: readonly string[];
    };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Runtime guard for the request contract. Type safety already forces callers in
 * static code to supply every field; this guards the boundary where a request
 * arrives untyped (deserialized JSON, an HTTP body). Returns the offending
 * field list rather than throwing, so a caller can map cleanly onto a
 * `ProviderResult` failure.
 */
export function validateProviderGenerateRequest(raw: unknown): ProviderRequestValidation {
  const invalidFields: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error: ProviderErrorCode.PROVIDER_CONTRACT_INVALID,
      invalidFields: [...REQUIRED_PROVIDER_REQUEST_FIELDS],
    };
  }

  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.projectId)) invalidFields.push("projectId");
  if (!isNonEmptyString(obj.articleBriefId)) invalidFields.push("articleBriefId");
  if (!isNonEmptyString(obj.model)) invalidFields.push("model");
  if (!isPositiveInteger(obj.maxTokens)) invalidFields.push("maxTokens");
  if (!isPositiveInteger(obj.timeoutMs)) invalidFields.push("timeoutMs");
  if (!isNonEmptyString(obj.requestId)) invalidFields.push("requestId");
  if (!isNonEmptyString(obj.idempotencyKey)) invalidFields.push("idempotencyKey");

  if (invalidFields.length > 0) {
    return {
      ok: false,
      error: ProviderErrorCode.PROVIDER_CONTRACT_INVALID,
      invalidFields,
    };
  }

  return {
    ok: true,
    request: {
      projectId: obj.projectId as string,
      articleBriefId: obj.articleBriefId as string,
      model: obj.model as string,
      maxTokens: obj.maxTokens as number,
      timeoutMs: obj.timeoutMs as number,
      requestId: obj.requestId as string,
      idempotencyKey: obj.idempotencyKey as string,
    },
  };
}
