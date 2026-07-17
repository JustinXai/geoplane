/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md (client-facing pages
 *   must not expose internal implementation details), docs/rebuild/recovered-evidence/
 *   TARGET_STATE_MANIFEST.md (internal pipeline vocabulary this project actually used,
 *   e.g. ArticleBriefCandidateV1, "provider_calls", failure codes referencing "PROVIDER")
 * reconstruction_reason: no original test source recoverable - see
 *   docs/rebuild/RECOVERY_GAP_ANALYSIS.md ("Test suite - Not recovered as files")
 * original_file_unavailable: true
 *
 * Checkpoint C2 compliance test: every human-visible display string rendered by the
 * CLIENT workspace surfaces (src/app/app/_fixtures.ts) must not contain a raw UUID, a
 * known AI/model provider or vendor name, or internal production-pipeline terminology
 * ("candidate", "brief", "artifact", "compiler", etc.). This is a plain string-pattern
 * check against the fixture-derived display strings, not a full render pipeline.
 */
import { describe, expect, it } from "vitest";
import { DELIVERY_ITEMS, collectClientVisibleStrings } from "../src/app/app/_fixtures.js";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Known AI/model provider & vendor names that must never appear in client-facing copy
// (per SYSTEM_INVARIANTS_V1 "client-facing pages must not expose ... provider/vendor
// names" and the Publication principles: WeChatSync-style bridges are not a default).
const PROVIDER_VENDOR_NAMES = [
  "openai",
  "deepseek",
  "anthropic",
  "claude",
  "gpt-4",
  "gpt4",
  "wechatsync",
  "chatgpt",
];

// Internal production-pipeline vocabulary (see TARGET_STATE_MANIFEST.md: ArticleBrief*,
// "candidate", provider_calls, etc.) that must not leak into client-facing copy - client
// copy should use plain, human-readable language instead.
const INTERNAL_PIPELINE_TERMS = ["candidate", "候选", "brief", "简报", "artifact", "产物", "compiler", "编译"];

describe("client workspace copy compliance (checkpoint C2)", () => {
  const strings = collectClientVisibleStrings();

  it("collected at least one display string per fixture surface", () => {
    // sanity check that the collector isn't accidentally returning nothing
    expect(strings.length).toBeGreaterThan(10);
  });

  it("contains no raw UUID in any client-visible display string", () => {
    for (const value of strings) {
      expect(value).not.toMatch(UUID_PATTERN);
    }
  });

  it("contains no AI/model provider or vendor name in any client-visible display string", () => {
    for (const value of strings) {
      const lowered = value.toLowerCase();
      for (const name of PROVIDER_VENDOR_NAMES) {
        expect(lowered.includes(name)).toBe(false);
      }
    }
  });

  it("contains no internal candidate/brief/artifact/compiler terminology in any client-visible display string", () => {
    for (const value of strings) {
      const lowered = value.toLowerCase();
      for (const term of INTERNAL_PIPELINE_TERMS) {
        expect(lowered.includes(term.toLowerCase())).toBe(false);
      }
    }
  });

  it("every delivery-center fixture item defaults to 0 selected distribution channels", () => {
    expect(DELIVERY_ITEMS.length).toBeGreaterThan(0);
    for (const item of DELIVERY_ITEMS) {
      expect(item.selectedChannelCount).toBe(0);
    }
  });
});
