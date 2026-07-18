/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: PROVIDER_IDENTITY_LEDGER_V1 — the Canonical Provider
 *   Identity contract for the controlled-provider lane. The one real canary call
 *   went through the Aliyun MaaS gateway to a DeepSeek model over the
 *   OpenAI-compatible protocol; the codebase previously described this loosely
 *   as a "DeepSeek direct" call, which conflates three orthogonal facts. This
 *   file makes each fact a first-class, closed enum:
 *     - WHICH GATEWAY terminated the HTTPS request (gatewayVendor),
 *     - WHOSE MODEL produced the completion (modelVendor),
 *     - WHICH WIRE PROTOCOL the request/response spoke (protocol).
 *   Every ledger row, execution record, and provider report describes the
 *   provider through this single contract — no parallel redefinitions.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * NO SECRETS, EVER (docs/governance/SYSTEM_INVARIANTS_V1.md). The identity is
 * DECLARED configuration, never derived from the base URL: parsing a URL to
 * infer the gateway would require carrying the endpoint host around, and the
 * endpoint host — like the API key, Authorization header, workspace id, prompt
 * text, and response text — is deliberately unrepresentable in every record and
 * column this contract feeds. An identity value is three closed-enum strings
 * and nothing else; it can be logged or persisted wholesale without ever
 * leaking a secret, because there is nowhere in the shape to put one.
 *
 * Also governance-free: an identity is an infrastructure fact ("which vendor's
 * gateway/model/protocol"), never a gate conclusion, approval, or publication
 * status.
 */

/**
 * WHICH GATEWAY terminated the HTTPS request. 'UNKNOWN_LEGACY' exists ONLY for
 * ledger rows backfilled from history recorded before this contract existed
 * (migration 0008's DDL default); the runtime never writes it for a new call —
 * see assertRuntimeProviderIdentity.
 */
export type ProviderGatewayVendor =
  | "DEEPSEEK_DIRECT"
  | "ALIYUN_MAAS"
  | "CUSTOM_OPENAI_COMPATIBLE"
  | "UNKNOWN_LEGACY";

/** WHOSE MODEL produced the completion (independent of the gateway in front of it). */
export type ProviderModelVendor = "DEEPSEEK" | "OPENAI" | "OTHER";

/** WHICH WIRE PROTOCOL the call spoke. Exactly one is supported today. */
export type ProviderProtocol = "OPENAI_COMPATIBLE";

/**
 * Every member of each closed set, frozen. Exported so tests can assert the
 * sets are complete and so the ledger/migration CHECK constraints can be
 * verified against one source of truth.
 */
export const PROVIDER_GATEWAY_VENDORS: readonly ProviderGatewayVendor[] = Object.freeze([
  "DEEPSEEK_DIRECT",
  "ALIYUN_MAAS",
  "CUSTOM_OPENAI_COMPATIBLE",
  "UNKNOWN_LEGACY",
]);

export const PROVIDER_MODEL_VENDORS: readonly ProviderModelVendor[] = Object.freeze([
  "DEEPSEEK",
  "OPENAI",
  "OTHER",
]);

export const PROVIDER_PROTOCOLS: readonly ProviderProtocol[] = Object.freeze([
  "OPENAI_COMPATIBLE",
]);

/**
 * The canonical identity of one provider integration: gateway + model vendor +
 * protocol. Non-secret by construction — three closed-enum strings, with no
 * field for a key, endpoint host, workspace id, or content.
 */
export interface ProviderIdentity {
  readonly gatewayVendor: ProviderGatewayVendor;
  readonly modelVendor: ProviderModelVendor;
  readonly protocol: ProviderProtocol;
}

/**
 * The identity of the CURRENT real integration: a DeepSeek model reached
 * through the Aliyun MaaS OpenAI-compatible gateway. This is the accurate
 * description of the one real canary call (previously mislabeled "DeepSeek
 * direct") and the default identity the adapter stamps on every new record.
 */
export const DEFAULT_PROVIDER_IDENTITY: ProviderIdentity = Object.freeze({
  gatewayVendor: "ALIYUN_MAAS",
  modelVendor: "DEEPSEEK",
  protocol: "OPENAI_COMPATIBLE",
});

/** Runtime type-guard: is `value` one of the closed gateway-vendor set? */
export function isProviderGatewayVendor(value: unknown): value is ProviderGatewayVendor {
  return (
    typeof value === "string" &&
    (PROVIDER_GATEWAY_VENDORS as readonly string[]).includes(value)
  );
}

/** Runtime type-guard: is `value` one of the closed model-vendor set? */
export function isProviderModelVendor(value: unknown): value is ProviderModelVendor {
  return (
    typeof value === "string" && (PROVIDER_MODEL_VENDORS as readonly string[]).includes(value)
  );
}

/** Runtime type-guard: is `value` the (single-member) closed protocol set? */
export function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return typeof value === "string" && (PROVIDER_PROTOCOLS as readonly string[]).includes(value);
}

/**
 * Guard for identities the RUNTIME is allowed to write. 'UNKNOWN_LEGACY' is a
 * backfill-only marker for pre-0008 history — a new execution always knows its
 * gateway (it is declared adapter configuration), so configuring the adapter
 * with UNKNOWN_LEGACY is a programming error, rejected here before any call.
 */
export function assertRuntimeProviderIdentity(identity: ProviderIdentity): ProviderIdentity {
  if (identity.gatewayVendor === "UNKNOWN_LEGACY") {
    throw new Error(
      "ProviderIdentity.gatewayVendor 'UNKNOWN_LEGACY' is reserved for backfilled " +
        "pre-0008 ledger history and may never be configured for a new execution.",
    );
  }
  return identity;
}
