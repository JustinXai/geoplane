/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: PROVIDER_PORT_AND_CONTRACT_V1 (checkpoint D1) — the
 *   record shapes the controlled-provider boundary emits for observability
 *   (execution / usage / failure). The durable ledger that persists them is D3;
 *   this checkpoint defines only the shapes.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * NO SECRETS, EVER. Per docs/governance/SYSTEM_INVARIANTS_V1.md ("No customer
 * data, no secrets"): there is deliberately NO field on any record below for an
 * api key, bearer token, authorization header, or raw credential of any kind.
 * These records store only non-secret operational facts — model, the canonical
 * provider identity (closed gateway/model-vendor/protocol enums, identity.ts —
 * never a base URL, endpoint host, or workspace id), token counts, latency, the
 * correlation/idempotency identifiers, and (on failure) a taxonomy code. A
 * record value can be logged or persisted wholesale without ever leaking a
 * secret, because there is nowhere in the shape to put one.
 *
 * Also governance-free: no gate status, approval status, evidence hash, or
 * publication status appears here — a provider execution record is an
 * infrastructure fact, not a business verdict.
 */
import type { ProviderErrorCode } from "./errors.js";
import type { ProviderIdentity } from "./identity.js";

/**
 * Token/latency usage for one successful provider call. No secret fields; no
 * content payload (content lives in `ProviderResult`, out of the record).
 */
export interface ProviderUsageRecord {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
}

/**
 * One provider execution attempt, success or failure. `outcome` discriminates:
 * a successful call carries a `usage` record and a null `errorCode`; a failed
 * call carries a taxonomy `errorCode` and a null `usage`.
 */
export interface ProviderExecutionRecord {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly articleBriefId: string;
  readonly model: string;
  /**
   * Canonical Provider Identity (identity.ts): which gateway terminated the
   * request, whose model answered, over which wire protocol. DECLARED adapter
   * configuration — never derived from (and never carrying) the base URL.
   */
  readonly identity: ProviderIdentity;
  readonly outcome: "OK" | "ERROR";
  readonly latencyMs: number;
  /** Present on success, null on failure. */
  readonly usage: ProviderUsageRecord | null;
  /** Present on failure (one taxonomy code), null on success. */
  readonly errorCode: ProviderErrorCode | null;
}

/**
 * A failed provider call, distilled to what a failure ledger needs: which call
 * (requestId / idempotencyKey), which model, which taxonomy code, and how long
 * before it failed. No secret, no content, no governance.
 */
export interface ProviderFailureRecord {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly errorCode: ProviderErrorCode;
  readonly latencyMs: number;
}

/** Non-secret identity/timing common to every record. Never carries a key. */
export interface ProviderCallMetadata {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly articleBriefId: string;
  readonly model: string;
  /** Canonical Provider Identity — closed-enum config, no URL/host/key/workspace. */
  readonly identity: ProviderIdentity;
  readonly latencyMs: number;
}

/** Build a usage record from non-secret call metadata + token counts. */
export function buildProviderUsageRecord(
  meta: ProviderCallMetadata,
  tokens: { readonly promptTokens: number; readonly completionTokens: number },
): ProviderUsageRecord {
  return {
    requestId: meta.requestId,
    idempotencyKey: meta.idempotencyKey,
    model: meta.model,
    promptTokens: tokens.promptTokens,
    completionTokens: tokens.completionTokens,
    totalTokens: tokens.promptTokens + tokens.completionTokens,
    latencyMs: meta.latencyMs,
  };
}

/** Build a success execution record. */
export function buildProviderSuccessRecord(
  meta: ProviderCallMetadata,
  usage: ProviderUsageRecord,
): ProviderExecutionRecord {
  return {
    requestId: meta.requestId,
    idempotencyKey: meta.idempotencyKey,
    projectId: meta.projectId,
    articleBriefId: meta.articleBriefId,
    model: meta.model,
    identity: meta.identity,
    outcome: "OK",
    latencyMs: meta.latencyMs,
    usage,
    errorCode: null,
  };
}

/** Build a failure execution record from a taxonomy code. */
export function buildProviderFailureRecord(
  meta: ProviderCallMetadata,
  errorCode: ProviderErrorCode,
): ProviderExecutionRecord {
  return {
    requestId: meta.requestId,
    idempotencyKey: meta.idempotencyKey,
    projectId: meta.projectId,
    articleBriefId: meta.articleBriefId,
    model: meta.model,
    identity: meta.identity,
    outcome: "ERROR",
    latencyMs: meta.latencyMs,
    usage: null,
    errorCode,
  };
}
