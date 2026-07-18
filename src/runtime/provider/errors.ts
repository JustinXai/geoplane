/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: PROVIDER_PORT_AND_CONTRACT_V1 (checkpoint D1 of the
 *   controlled-provider lane) — the error taxonomy for the controlled-provider
 *   boundary. No original source recoverable for this lane.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * The provider error taxonomy. A single, closed enum of every failure mode the
 * controlled-provider boundary is allowed to surface. Every provider failure —
 * from the offline adapter now, from the OpenAI-compatible adapter in D2 later —
 * MUST map onto exactly one of these codes; there is no "unknown"/free-text
 * error escape hatch, so a caller can exhaustively `switch` over the taxonomy.
 *
 * Deliberately governance-free: none of these codes carries or implies a gate
 * conclusion, approval status, or publication status. A provider failure is an
 * infrastructure fact ("the model call timed out"), never a business verdict.
 */
export enum ProviderErrorCode {
  /** The provider call exceeded its `timeoutMs` budget. */
  PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT",
  /** The provider rejected the call with a rate-limit / quota signal. */
  PROVIDER_RATE_LIMIT = "PROVIDER_RATE_LIMIT",
  /** The provider rejected the credentials (bad/missing/expired key). */
  PROVIDER_AUTH_FAILED = "PROVIDER_AUTH_FAILED",
  /**
   * The provider returned something that is not valid user-visible article
   * content — most importantly, output that attempts to carry governance
   * state (gate status, approval status, evidence hash, publication status,
   * channel selection). See contract-validation.ts.
   */
  PROVIDER_CONTRACT_INVALID = "PROVIDER_CONTRACT_INVALID",
  /** The provider returned nothing / empty content. */
  PROVIDER_EMPTY_RESPONSE = "PROVIDER_EMPTY_RESPONSE",
  /** The provider hit a token limit (prompt too large, or completion truncated to nothing usable). */
  PROVIDER_TOKEN_LIMIT = "PROVIDER_TOKEN_LIMIT",
  /**
   * The provider runtime is not available for a real call — including the
   * feature-flag-off case: a real provider call was attempted while
   * PROVIDER_RUNTIME_ENABLED is false. See feature-flag.ts.
   */
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE",
}

/**
 * Every member of the taxonomy, frozen. Exported so a test can assert the
 * taxonomy is complete (no member silently dropped) without reaching into the
 * enum object, and so callers can iterate the closed set.
 */
export const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = Object.freeze([
  ProviderErrorCode.PROVIDER_TIMEOUT,
  ProviderErrorCode.PROVIDER_RATE_LIMIT,
  ProviderErrorCode.PROVIDER_AUTH_FAILED,
  ProviderErrorCode.PROVIDER_CONTRACT_INVALID,
  ProviderErrorCode.PROVIDER_EMPTY_RESPONSE,
  ProviderErrorCode.PROVIDER_TOKEN_LIMIT,
  ProviderErrorCode.PROVIDER_UNAVAILABLE,
]);

/** Runtime type-guard: is `value` one of the taxonomy's codes? */
export function isProviderErrorCode(value: unknown): value is ProviderErrorCode {
  return typeof value === "string" && (PROVIDER_ERROR_CODES as readonly string[]).includes(value);
}
