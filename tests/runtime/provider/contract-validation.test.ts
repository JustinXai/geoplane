/**
 * PROVIDER_PORT_AND_CONTRACT_V1 — contract-validation (governance firewall) tests.
 *
 * Proves the model can ONLY produce user-visible content: any output carrying
 * governance state (gate status, approval status, evidence hash, publication
 * status, channel selection, any lifecycle status) is rejected as
 * PROVIDER_CONTRACT_INVALID; empty output is PROVIDER_EMPTY_RESPONSE; only the
 * clean user-visible shape is accepted.
 */
import { describe, expect, it } from "vitest";
import { validateProviderContent } from "../../../src/runtime/provider/contract-validation.js";
import { ProviderErrorCode } from "../../../src/runtime/provider/errors.js";
import { PROVIDER_ARTICLE_CONTENT_V1 } from "../../../src/runtime/provider/provider-port.js";

function validContent(): Record<string, unknown> {
  return {
    schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
    title: "How to choose a knowledge base",
    summary: "A practical guide for teams.",
    sections: [
      { heading: "Why it matters", body: "Knowledge grounding improves answers." },
      { heading: "Getting started", body: "Start with your top questions." },
    ],
  };
}

describe("validateProviderContent — accepts clean user-visible content", () => {
  it("accepts a well-formed ProviderArticleContentV1", () => {
    const result = validateProviderContent(validContent());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.schemaVersion).toBe(PROVIDER_ARTICLE_CONTENT_V1);
      expect(result.content.sections.length).toBe(2);
      expect(result.content.title).toBe("How to choose a knowledge base");
    }
  });
});

describe("validateProviderContent — rejects empty output as PROVIDER_EMPTY_RESPONSE", () => {
  const emptyCases: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace string", "   "],
    ["empty object", {}],
    [
      "all-blank content",
      {
        schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
        title: "   ",
        summary: "",
        sections: [{ heading: "  ", body: "" }],
      },
    ],
    [
      "no sections",
      { schemaVersion: PROVIDER_ARTICLE_CONTENT_V1, title: "", summary: "", sections: [] },
    ],
  ];

  for (const [name, raw] of emptyCases) {
    it(`rejects ${name}`, () => {
      const result = validateProviderContent(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(ProviderErrorCode.PROVIDER_EMPTY_RESPONSE);
      }
    });
  }
});

describe("validateProviderContent — rejects governance-laden output as PROVIDER_CONTRACT_INVALID", () => {
  // Each case takes valid content and smuggles in a governance field/value.
  const governanceCases: Array<[string, Record<string, unknown>]> = [
    ["gate status", { ...validContent(), qualityGateStatus: "PASSED" }],
    ["gate kind", { ...validContent(), gateKind: "PLATFORM_GATE" }],
    ["gate level applied", { ...validContent(), gateLevelApplied: "INDUSTRY_VERTICAL_GATE" }],
    ["gate failure reasons", { ...validContent(), failureReasons: ["nope"] }],
    ["approval status", { ...validContent(), approvalStatus: "APPROVED" }],
    ["approver identity", { ...validContent(), approverId: "user_x", approvedAt: "2026-01-01" }],
    ["reviewer identity", { ...validContent(), reviewerId: "user_y" }],
    [
      "authorizing review decision",
      { ...validContent(), authorizingHumanReviewDecisionId: "hr_1" },
    ],
    ["validation status", { ...validContent(), validationStatus: "VALIDATED" }],
    ["evidence hash", { ...validContent(), evidenceHash: "deadbeef" }],
    ["event hash", { ...validContent(), eventHash: "deadbeef" }],
    ["envelope pointer", { ...validContent(), providerResponseEnvelopeId: "env_1" }],
    ["publication status", { ...validContent(), publicationStatus: "PUBLISHED" }],
    ["published-by actor", { ...validContent(), publishedByActorId: "user_z" }],
    ["channel selection", { ...validContent(), targetChannelIds: ["ch_1"] }],
    ["distribution plan", { ...validContent(), distributionPlanId: "dp_1" }],
    ["lifecycle status", { ...validContent(), status: "SEALED" }],
    ["sealed timestamp", { ...validContent(), sealedAt: "2026-01-01" }],
    [
      "governance nested inside a section",
      {
        schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
        title: "t",
        summary: "s",
        sections: [{ heading: "h", body: "b", approvalStatus: "APPROVED" }],
      },
    ],
    [
      "governance verdict smuggled as a section body value",
      {
        schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
        title: "t",
        summary: "s",
        sections: [{ heading: "h", body: "PUBLISHED" }],
      },
    ],
  ];

  for (const [name, raw] of governanceCases) {
    it(`rejects ${name}`, () => {
      const result = validateProviderContent(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
      }
    });
  }
});

describe("validateProviderContent — rejects malformed shape as PROVIDER_CONTRACT_INVALID", () => {
  const malformedCases: Array<[string, unknown]> = [
    ["bare non-empty string", "just some text"],
    ["array", [{ heading: "h", body: "b" }]],
    ["wrong schemaVersion", { ...validContent(), schemaVersion: "SomethingElseV9" }],
    ["unknown top-level key", { ...validContent(), extraneous: "x" }],
    [
      "non-string title",
      { schemaVersion: PROVIDER_ARTICLE_CONTENT_V1, title: 42, summary: "s", sections: [] },
    ],
    [
      "section missing body",
      {
        schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
        title: "t",
        summary: "s",
        sections: [{ heading: "h" }],
      },
    ],
    [
      "unknown key inside a section",
      {
        schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
        title: "t",
        summary: "s",
        sections: [{ heading: "h", body: "b", footnote: "x" }],
      },
    ],
  ];

  for (const [name, raw] of malformedCases) {
    it(`rejects ${name}`, () => {
      const result = validateProviderContent(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(ProviderErrorCode.PROVIDER_CONTRACT_INVALID);
      }
    });
  }
});
