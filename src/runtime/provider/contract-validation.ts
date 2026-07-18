/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: PROVIDER_PORT_AND_CONTRACT_V1 (checkpoint D1) — the
 *   governance firewall on provider output. This is the runtime enforcement of
 *   the strict Stage-1/Stage-2 layering documented in provider-port.ts.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * `validateProviderContent(raw)` is the gate every provider response passes
 * through before it is allowed to become a `ProviderArticleContentV1`. It:
 *
 *   1. rejects empty/absent output as PROVIDER_EMPTY_RESPONSE;
 *   2. rejects any output that carries or attempts governance state — gate
 *      status, approval status, evidence hash, publication status, channel
 *      selection, or any lifecycle status — as PROVIDER_CONTRACT_INVALID
 *      (a language model may NEVER produce governance; that is injected
 *      deterministically downstream by Stage 2);
 *   3. accepts ONLY the user-visible content shape (schemaVersion + title +
 *      summary + non-empty prose sections), rejecting unknown keys, as a
 *      defense-in-depth whitelist so nothing can be smuggled alongside the
 *      allowed fields.
 *
 * Governance detection is intentionally run BEFORE the shape whitelist so a
 * governance-laden payload is attributed to governance (not merely "unknown
 * field"), and it walks the whole object graph — a governance field buried in a
 * nested object is caught just the same.
 */
import {
  PROVIDER_ARTICLE_CONTENT_V1,
  providerErr,
  providerOk,
  type ProviderArticleContentSectionV1,
  type ProviderArticleContentV1,
  type ProviderResult,
} from "./provider-port.js";
import { ProviderErrorCode } from "./errors.js";

/**
 * Lowercased key fragments that mark a value as governance state. A key is
 * rejected if its lowercased form CONTAINS any of these. None of the allowed
 * content keys (schemaVersion/title/summary/sections/heading/body) contains any
 * of these fragments, so this never produces a false positive on valid content.
 */
const GOVERNANCE_KEY_FRAGMENTS: readonly string[] = [
  "gate", // gateStatus, gateKind, qualityGateStatus, platformGateStatus, verticalGateStatus, gateLevelApplied
  "approv", // approvalStatus, approvedAt, approverId, contentApprovalStatus
  "reviewer", // reviewerId
  "humanreview", // humanReviewDecision / humanReviewDecisionId
  "authorizing", // authorizingHumanReviewDecisionId, authorizingReviewDecisionStatus
  "status", // any *Status / lifecycle status field
  "publish", // publishedByActorId, publishedAt, publishPackageId, publicationStatus
  "publication", // publicationStatus
  "channel", // channelId, channelIds, targetChannelIds
  "selectedby", // selectedByActorId
  "selectedat", // selectedAt
  "distributionplan", // distributionPlanId
  "sealed", // sealedAt
  "evidencehash", // evidenceHash
  "eventhash", // eventHash
  "decisionhash", // decisionHash
  "contenthash", // contentHash
  "payloadhash", // payloadHash
  "envelopeid", // providerResponseEnvelopeId / envelopeId
  "evidenceid", // evidenceId
  "validation", // opportunityValidationStatus / validationStatus
];

/**
 * Exact governance verdict/status string VALUES. Matched on trimmed exact
 * equality (not substring), so ordinary prose that merely mentions a word is
 * never flagged — only a value that IS one of these governance tokens is. This
 * catches an attempt to smuggle a verdict into an otherwise-allowed field.
 */
const GOVERNANCE_VALUE_LITERALS: ReadonlySet<string> = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
  "PENDING_VALIDATION",
  "VALIDATED",
  "PASSED",
  "FAILED",
  "SEALED",
  "PACKAGED",
  "CHANNELS_SELECTED",
  "PARTIALLY_PUBLISHED",
  "PUBLISHED",
  "PLATFORM_WIDE_GATE",
  "INDUSTRY_VERTICAL_GATE",
  "PLATFORM_GATE",
  "VERTICAL_GATE",
  "ESCALATED_FOR_HUMAN_REVIEW",
  "NEEDS_HUMAN_REVIEW",
]);

/** The only keys a valid content object may carry, at the top level. */
const ALLOWED_CONTENT_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "title",
  "summary",
  "sections",
]);

/** The only keys a valid section may carry. */
const ALLOWED_SECTION_KEYS: ReadonlySet<string> = new Set(["heading", "body"]);

function isGovernanceKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return GOVERNANCE_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/**
 * Deep-walk `value` looking for any governance key or governance value.
 * Returns true on the first hit. Depth-bounded (JSON-shaped input only) so a
 * pathological structure cannot cause unbounded recursion.
 */
function containsGovernance(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;

  if (typeof value === "string") {
    return GOVERNANCE_VALUE_LITERALS.has(value.trim());
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsGovernance(item, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isGovernanceKey(key)) return true;
      if (containsGovernance(nested, depth + 1)) return true;
    }
  }

  return false;
}

/** True when the raw value is null/undefined or an empty/whitespace string. */
function isHardEmpty(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === "string" && raw.trim() === "") return true;
  return false;
}

/**
 * Validate raw provider output into a `ProviderResult`. Success carries a
 * normalized `ProviderArticleContentV1`; failure carries a taxonomy code
 * (PROVIDER_EMPTY_RESPONSE or PROVIDER_CONTRACT_INVALID).
 */
export function validateProviderContent(raw: unknown): ProviderResult {
  // 1. Empty / absent.
  if (isHardEmpty(raw)) {
    return providerErr(ProviderErrorCode.PROVIDER_EMPTY_RESPONSE);
  }

  // A non-object (bare string/number/boolean) is not the structured shape.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
  }

  // An object with no own keys is empty content.
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).length === 0) {
    return providerErr(ProviderErrorCode.PROVIDER_EMPTY_RESPONSE);
  }

  // 2. Governance firewall — run first so a governance payload is attributed
  //    to governance, and walked deeply so nested smuggling is caught too.
  if (containsGovernance(obj)) {
    return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
  }

  // 3a. Whitelist top-level keys.
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_CONTENT_KEYS.has(key)) {
      return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
    }
  }

  // 3b. schemaVersion tag.
  if (obj.schemaVersion !== PROVIDER_ARTICLE_CONTENT_V1) {
    return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
  }

  // 3c. title / summary types.
  const { title, summary, sections } = obj;
  if (typeof title !== "string" || typeof summary !== "string") {
    return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
  }
  if (!Array.isArray(sections)) {
    return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
  }

  // 3d. Validate + normalize each section.
  const normalizedSections: ProviderArticleContentSectionV1[] = [];
  for (const rawSection of sections) {
    if (typeof rawSection !== "object" || rawSection === null || Array.isArray(rawSection)) {
      return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
    }
    const section = rawSection as Record<string, unknown>;
    for (const key of Object.keys(section)) {
      if (!ALLOWED_SECTION_KEYS.has(key)) {
        return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
      }
    }
    if (typeof section.heading !== "string" || typeof section.body !== "string") {
      return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
    }
    normalizedSections.push({ heading: section.heading, body: section.body });
  }

  // 4. Emptiness of the (structurally valid) content: no sections, or nothing
  //    but blank text everywhere, is an empty response.
  const first = normalizedSections[0];
  if (first === undefined) {
    return providerErr(ProviderErrorCode.PROVIDER_EMPTY_RESPONSE);
  }
  const hasVisibleText =
    title.trim() !== "" ||
    normalizedSections.some(
      (section) => section.heading.trim() !== "" || section.body.trim() !== "",
    );
  if (!hasVisibleText) {
    return providerErr(ProviderErrorCode.PROVIDER_EMPTY_RESPONSE);
  }

  const content: ProviderArticleContentV1 = {
    schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
    title,
    summary,
    sections: [first, ...normalizedSections.slice(1)],
  };
  return providerOk(content);
}
