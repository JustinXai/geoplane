/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md
 * reconstruction_reason: no original source recoverable for this chain
 * original_file_unavailable: true
 *
 * Checkpoint D5 tests — QualityGate / PlatformGate / VerticalGate /
 * ArticleApproval / evaluateQualityGate
 * (src/contracts/geo-business/entities.ts). Covers:
 *
 * 1. Determinism: `evaluateQualityGate` called twice with identical inputs
 *    produces byte-identical (deep-equal) output, mirroring the D4
 *    `compileArticleDraft` determinism test in
 *    tests/contracts/geo-business-compiler.test.ts.
 * 2. Fixture-based smoke tests for PlatformGate / VerticalGate / a valid
 *    ArticleApproval built from three real PASSED gate results.
 * 3. `@ts-expect-error` proof that an ArticleApproval cannot be
 *    constructed with a failed or missing gate result, matching the
 *    D2/D3 `@ts-expect-error` pattern.
 */
import { describe, expect, it } from "vitest";
import {
  compileArticleDraft,
  evaluateQualityGate,
  type ArticleApproval,
  type ArticleBrief,
  type ArticleBriefPlanningContextV1,
  type ArticleDraft,
  type FailedQualityGate,
  type PassedPlatformGate,
  type PassedQualityGate,
  type PassedVerticalGate,
  type PlatformGate,
  type ProviderArticleContent,
  type QualityGate,
  type VerticalGate,
} from "../../src/contracts/geo-business/entities.js";

const CLIENT_ORGANIZATION_ID = "org_client_acme";
const PROJECT_ID = "proj_acme_main_site";

const planningContext: ArticleBriefPlanningContextV1 = {
  schemaVersion: "ArticleBriefPlanningContextV1",
  opportunityFamilyId: "fam_0001",
  authorizingHumanReviewDecisionIds: ["hrd_family_0001", "hrd_family_0002"],
  targetKeywords: ["geo article production", "tenant isolation"],
  riskLevel: "STANDARD",
};

const brief: ArticleBrief = {
  id: "brief_0001",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  opportunityFamilyId: "fam_0001",
  planningContext,
  workingTitle: "GEO article production and tenant isolation, explained",
  outline: ["What is GEO article production?", "How is tenant data isolated?"],
  createdAt: "2026-07-15T00:00:00.000Z",
};

const providerContentOne: ProviderArticleContent = {
  id: "pac_0001",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  articleBriefId: brief.id,
  providerResponseEnvelopeId: "envelope_0001",
  receivedAt: "2026-07-16T00:00:00.000Z",
};

const providerContentTwo: ProviderArticleContent = {
  id: "pac_0002",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  articleBriefId: brief.id,
  providerResponseEnvelopeId: "envelope_0002",
  receivedAt: "2026-07-16T00:05:00.000Z",
};

const compilationIdentity = {
  id: "adraft_0001",
  version: 1,
  compiledAt: "2026-07-16T01:00:00.000Z",
};

const draft: ArticleDraft = compileArticleDraft(
  brief,
  [providerContentOne, providerContentTwo],
  compilationIdentity,
);

const qualityGateIdentity = {
  id: "qg_0001",
  evaluatedAt: "2026-07-17T00:00:00.000Z",
};

describe("evaluateQualityGate — determinism", () => {
  it("produces byte-identical (deep-equal) output across two calls with identical inputs", () => {
    const first = evaluateQualityGate(draft, brief, qualityGateIdentity);
    const second = evaluateQualityGate(draft, brief, qualityGateIdentity);

    expect(first).toStrictEqual(second);
    expect(first).toStrictEqual({
      id: "qg_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      articleDraftId: draft.id,
      status: "PASSED",
      evaluatedAt: "2026-07-17T00:00:00.000Z",
    });
  });

  it("does not mutate its inputs", () => {
    const draftSnapshot = JSON.parse(JSON.stringify(draft));
    const briefSnapshot = JSON.parse(JSON.stringify(brief));

    evaluateQualityGate(draft, brief, qualityGateIdentity);

    expect(draft).toEqual(draftSnapshot);
    expect(brief).toEqual(briefSnapshot);
  });

  it("passes a well-formed ArticleDraft compiled from a complete ArticleBrief", () => {
    const gate: QualityGate = evaluateQualityGate(draft, brief, qualityGateIdentity);

    expect(gate.status).toBe("PASSED");
    expect(gate.articleDraftId).toBe(draft.id);
    // A PASSED QualityGate carries no failureReasons field.
    expect("failureReasons" in gate).toBe(false);
  });

  it("fails with non-empty reasons when the draft has zero sections", () => {
    const emptyOutlineBrief: ArticleBrief = {
      ...brief,
      id: "brief_empty_outline",
      outline: [],
    };
    const emptyDraft: ArticleDraft = compileArticleDraft(
      emptyOutlineBrief,
      [{ ...providerContentOne, articleBriefId: emptyOutlineBrief.id }],
      { id: "adraft_empty", version: 1, compiledAt: "2026-07-16T01:00:00.000Z" },
    );

    const gate: QualityGate = evaluateQualityGate(emptyDraft, emptyOutlineBrief, {
      id: "qg_empty",
      evaluatedAt: "2026-07-17T00:00:00.000Z",
    });

    expect(gate.status).toBe("FAILED");
    const failed = gate as FailedQualityGate;
    expect(failed.failureReasons.length).toBeGreaterThan(0);
    expect(failed.failureReasons.some((reason) => /zero sections/.test(reason))).toBe(true);
  });

  it("fails with non-empty reasons when the draft's articleBriefId does not match the evaluated brief", () => {
    const otherBrief: ArticleBrief = { ...brief, id: "brief_other" };

    const gate: QualityGate = evaluateQualityGate(draft, otherBrief, {
      id: "qg_mismatch",
      evaluatedAt: "2026-07-17T00:00:00.000Z",
    });

    expect(gate.status).toBe("FAILED");
    const failed = gate as FailedQualityGate;
    expect(failed.failureReasons.some((reason) => /does not match/.test(reason))).toBe(true);
  });
});

describe("PlatformGate / VerticalGate", () => {
  it("scopes a PASSED PlatformGate to the ArticleDraft and IndustryProfile it evaluated", () => {
    const platformGate: PassedPlatformGate = {
      id: "pg_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      gateKind: "PLATFORM_GATE",
      articleDraftId: draft.id,
      industryProfileId: "ind_0001",
      gateLevelApplied: "PLATFORM_WIDE_GATE",
      status: "PASSED",
      evaluatedAt: "2026-07-17T00:10:00.000Z",
    };

    expect(platformGate.articleDraftId).toBe(draft.id);
    expect(platformGate.gateKind).toBe("PLATFORM_GATE");
    expect(["PLATFORM_WIDE_GATE", "INDUSTRY_VERTICAL_GATE"]).toContain(
      platformGate.gateLevelApplied,
    );
    // Accepted through the wider PlatformGate union.
    const asUnion: PlatformGate = platformGate;
    expect(asUnion.status).toBe("PASSED");
  });

  it("scopes a FAILED VerticalGate to the ArticleDraft and IndustryProfile it evaluated, with non-empty reasons", () => {
    const verticalGate: VerticalGate = {
      id: "vg_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      gateKind: "VERTICAL_GATE",
      articleDraftId: draft.id,
      industryProfileId: "ind_0001",
      gateLevelApplied: "INDUSTRY_VERTICAL_GATE",
      status: "FAILED",
      failureReasons: ["Missing required healthcare-vertical disclosure section."],
      evaluatedAt: "2026-07-17T00:11:00.000Z",
    };

    expect(verticalGate.status).toBe("FAILED");
    expect(verticalGate.gateKind).toBe("VERTICAL_GATE");
    if (verticalGate.status === "FAILED") {
      expect(verticalGate.failureReasons.length).toBeGreaterThan(0);
    }
  });

  /**
   * PlatformGate and VerticalGate must stay clearly distinguished (per the
   * file-level NAMING CAUTION in entities.ts) even though their fields are
   * otherwise identical — `gateKind` is a discriminant literal that makes
   * them structurally incompatible, not just differently named.
   */
  it("does not type-check a PlatformGate-shaped object assigned to a VerticalGate-typed slot", () => {
    const platformShaped: PassedPlatformGate = {
      id: "pg_0002",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      gateKind: "PLATFORM_GATE",
      articleDraftId: draft.id,
      industryProfileId: "ind_0001",
      gateLevelApplied: "PLATFORM_WIDE_GATE",
      status: "PASSED",
      evaluatedAt: "2026-07-17T00:12:00.000Z",
    };

    // @ts-expect-error - platformShaped.gateKind is the literal
    // "PLATFORM_GATE", which is not assignable to VerticalGate's
    // "VERTICAL_GATE" discriminant, even though every other field matches.
    const misassigned: VerticalGate = platformShaped;

    expect(misassigned).toBeTruthy();
  });
});

describe("ArticleApproval", () => {
  const passedQualityGate: PassedQualityGate = {
    id: "qg_approval_0001",
    clientOrganizationId: CLIENT_ORGANIZATION_ID,
    projectId: PROJECT_ID,
    articleDraftId: draft.id,
    status: "PASSED",
    evaluatedAt: "2026-07-17T01:00:00.000Z",
  };

  const passedPlatformGate: PassedPlatformGate = {
    id: "pg_approval_0001",
    clientOrganizationId: CLIENT_ORGANIZATION_ID,
    projectId: PROJECT_ID,
    gateKind: "PLATFORM_GATE",
    articleDraftId: draft.id,
    industryProfileId: "ind_0001",
    gateLevelApplied: "PLATFORM_WIDE_GATE",
    status: "PASSED",
    evaluatedAt: "2026-07-17T01:01:00.000Z",
  };

  const passedVerticalGate: PassedVerticalGate = {
    id: "vg_approval_0001",
    clientOrganizationId: CLIENT_ORGANIZATION_ID,
    projectId: PROJECT_ID,
    gateKind: "VERTICAL_GATE",
    articleDraftId: draft.id,
    industryProfileId: "ind_0001",
    gateLevelApplied: "INDUSTRY_VERTICAL_GATE",
    status: "PASSED",
    evaluatedAt: "2026-07-17T01:02:00.000Z",
  };

  it("builds a valid ArticleApproval referencing three real PASSED gate results", () => {
    const approval: ArticleApproval = {
      id: "approval_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      articleDraftId: draft.id,
      approverId: "user_platform_jane",
      approvedAt: "2026-07-17T02:00:00.000Z",
      qualityGateId: passedQualityGate.id,
      qualityGateStatus: passedQualityGate.status,
      platformGateId: passedPlatformGate.id,
      platformGateStatus: passedPlatformGate.status,
      verticalGateId: passedVerticalGate.id,
      verticalGateStatus: passedVerticalGate.status,
    };

    expect(approval.articleDraftId).toBe(draft.id);
    expect(approval.approverId).toBeTruthy();
    expect(approval.approvedAt).toBeTruthy();
    // Not orphaned: every referenced gate id resolves to a real fixture
    // above, each scoped to the same ArticleDraft this approval is for.
    expect(passedQualityGate.articleDraftId).toBe(draft.id);
    expect(passedPlatformGate.articleDraftId).toBe(draft.id);
    expect(passedVerticalGate.articleDraftId).toBe(draft.id);
    expect(approval.qualityGateStatus).toBe("PASSED");
    expect(approval.platformGateStatus).toBe("PASSED");
    expect(approval.verticalGateStatus).toBe("PASSED");
  });

  /**
   * The core D5 guarantee: an ArticleApproval literally cannot be
   * constructed with a FAILED (or missing) gate result — enforced by
   * `npm run typecheck`, not a runtime `if` check. Mirrors the D2
   * HumanReviewDecision / D3 OpportunityFamilyMember `@ts-expect-error`
   * pattern.
   */
  it("does not type-check an ArticleApproval referencing a FAILED QualityGate", () => {
    const failedQualityGate: FailedQualityGate = {
      id: "qg_approval_failed",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      articleDraftId: draft.id,
      status: "FAILED",
      failureReasons: ["ArticleDraft has zero sections; minimum content presence check failed."],
      evaluatedAt: "2026-07-17T01:03:00.000Z",
    };

    const illegalApproval: ArticleApproval = {
      id: "approval_illegal_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      articleDraftId: draft.id,
      approverId: "user_platform_jane",
      approvedAt: "2026-07-17T02:01:00.000Z",
      qualityGateId: failedQualityGate.id,
      // @ts-expect-error - failedQualityGate.status is "FAILED", and
      // ArticleApproval.qualityGateStatus only accepts the literal
      // "PASSED"; a failed QualityGate can never authorize an approval.
      qualityGateStatus: failedQualityGate.status,
      platformGateId: passedPlatformGate.id,
      platformGateStatus: passedPlatformGate.status,
      verticalGateId: passedVerticalGate.id,
      verticalGateStatus: passedVerticalGate.status,
    };

    expect(illegalApproval).toBeTruthy();
  });

  it("does not type-check an ArticleApproval missing its verticalGate reference entirely", () => {
    // @ts-expect-error - verticalGateId and verticalGateStatus are
    // required and non-optional; an ArticleApproval object literal
    // omitting them (as if only two of the three gates had run) must fail
    // to compile.
    const missingVerticalGate: ArticleApproval = {
      id: "approval_illegal_0002",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      articleDraftId: draft.id,
      approverId: "user_platform_jane",
      approvedAt: "2026-07-17T02:02:00.000Z",
      qualityGateId: passedQualityGate.id,
      qualityGateStatus: passedQualityGate.status,
      platformGateId: passedPlatformGate.id,
      platformGateStatus: passedPlatformGate.status,
    };

    expect(missingVerticalGate).toBeTruthy();
  });

  it("does not type-check a boolean-shaped 'approved: true' object masquerading as an ArticleApproval", () => {
    // @ts-expect-error - ArticleApproval has no boolean-flag shape; every
    // valid value requires real gate references plus a reviewer identity
    // and timestamp, so a bare `{ approved: true }` can never satisfy the
    // type. Same "no silently-approved state" guarantee as D2's
    // HumanReviewDecision test.
    const fakeApproval: ArticleApproval = { approved: true };

    expect(fakeApproval).toBeTruthy();
  });
});
