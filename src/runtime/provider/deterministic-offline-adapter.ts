/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: PROVIDER_PORT_AND_CONTRACT_V1 (checkpoint D1) — the
 *   offline, deterministic ProviderPort implementation used in tests and as the
 *   default while the feature flag is off.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * PROVIDER REAL CALLS = 0, structurally. This adapter has NO network import of
 * any kind (no fetch/http/undici/openai/anthropic/...) — content is derived by
 * a pure, in-process hash of the request. Same request in -> byte-identical
 * content out, every time, with zero I/O. Because it never reaches the network,
 * it is safe to run as the default while PROVIDER_RUNTIME_ENABLED is off; it
 * therefore does NOT call the feature-flag guard (that guard is only for
 * adapters that would actually make a real call — the D2 real adapter).
 *
 * Governance-free by construction: it builds a `ProviderArticleContentV1`
 * (Stage-1 user-visible content only) and, defensively, runs its own output
 * through `validateProviderContent` before returning — so even this adapter is
 * held to the same governance firewall as a real provider.
 */
import {
  PROVIDER_ARTICLE_CONTENT_V1,
  providerErr,
  validateProviderGenerateRequest,
  type ProviderArticleContentSectionV1,
  type ProviderGenerateArticleContentRequest,
  type ProviderPort,
  type ProviderResult,
} from "./provider-port.js";
import { validateProviderContent } from "./contract-validation.js";
import { ProviderErrorCode } from "./errors.js";

/** FNV-1a 32-bit hash. Pure, deterministic, no imports, no I/O. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable seed string for one request — every field participates. */
function seedFor(request: ProviderGenerateArticleContentRequest): string {
  return [
    request.projectId,
    request.articleBriefId,
    request.model,
    String(request.maxTokens),
    String(request.timeoutMs),
    request.requestId,
    request.idempotencyKey,
  ].join("␟"); // unit separator, unlikely to collide with field content
}

/**
 * A ProviderPort that produces deterministic offline content with no network.
 * Optionally seeded with a `label` so two differently-configured offline
 * adapters produce distinguishable (but each still deterministic) content.
 */
export class DeterministicOfflineProviderAdapter implements ProviderPort {
  constructor(private readonly label: string = "offline") {}

  async generateArticleContent(
    request: ProviderGenerateArticleContentRequest,
  ): Promise<ProviderResult> {
    // Runtime guard: refuse a malformed request at the boundary.
    const validated = validateProviderGenerateRequest(request);
    if (!validated.ok) {
      return providerErr(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
    }

    const seed = fnv1a(`${this.label}␟${seedFor(validated.request)}`);

    // Derive 2..4 sections deterministically from the seed.
    const sectionCount = (seed % 3) + 2;
    const sections: ProviderArticleContentSectionV1[] = [];
    for (let index = 0; index < sectionCount; index += 1) {
      const sectionSeed = fnv1a(`${seed}␟${index}`);
      sections.push({
        heading: `Section ${index + 1} (${sectionSeed.toString(16)})`,
        body:
          `Deterministic offline content for brief ${validated.request.articleBriefId}, ` +
          `section ${index + 1}. Derived token ${sectionSeed.toString(36)}.`,
      });
    }

    const first = sections[0];
    if (first === undefined) {
      // Unreachable: sectionCount >= 2. Kept for noUncheckedIndexedAccess.
      return providerErr(ProviderErrorCode.PROVIDER_EMPTY_RESPONSE);
    }

    const candidate = {
      schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
      title: `Draft for brief ${validated.request.articleBriefId} (${seed.toString(16)})`,
      summary:
        `Offline deterministic draft for project ${validated.request.projectId}, ` +
        `model ${validated.request.model}.`,
      sections: [first, ...sections.slice(1)],
    };

    // Defensive: hold our own output to the governance firewall too.
    return validateProviderContent(candidate);
  }
}
