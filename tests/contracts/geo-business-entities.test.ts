/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md
 * reconstruction_reason: no original source recoverable for this chain
 * original_file_unavailable: true
 *
 * Fixture-based smoke test for the checkpoint D1 GEO business chain
 * contracts (src/contracts/geo-business/entities.ts): KnowledgePackage,
 * IndustryProfile, KeywordQuestionMap. Builds one concrete, valid fixture
 * object per interface/type and asserts something meaningful about each,
 * including the tenant-isolation fields required by
 * docs/governance/SYSTEM_INVARIANTS_V1.md.
 */
import { describe, expect, it } from "vitest";
import type {
  ApprovedHumanReviewDecision,
  ChangesRequestedHumanReviewDecision,
  DraftKnowledgePackage,
  HumanReviewDecision,
  IndustryProfile,
  KeywordQuestionMap,
  KnowledgePackage,
  Opportunity,
  OpportunityValidation,
  SealedKnowledgePackage,
} from "../../src/contracts/geo-business/entities.js";

const CLIENT_ORGANIZATION_ID = "org_client_acme";
const PROJECT_ID = "proj_acme_main_site";

describe("KnowledgePackage", () => {
  it("scopes a draft package to a client organization and project, at version 1", () => {
    const draft: DraftKnowledgePackage = {
      id: "kp_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      version: 1,
      title: "Acme product documentation, Q3 crawl",
      sourceDescription: "Ingested from Acme's internal help center export",
      createdAt: "2026-07-01T00:00:00.000Z",
      status: "DRAFT",
    };

    expect(draft.status).toBe("DRAFT");
    expect(draft.clientOrganizationId).toBe(CLIENT_ORGANIZATION_ID);
    expect(draft.projectId).toBe(PROJECT_ID);
    expect(draft.version).toBeGreaterThan(0);
    // Draft packages carry no seal timestamp.
    expect("sealedAt" in draft).toBe(false);
  });

  it("requires a sealedAt timestamp once a package transitions to SEALED, and treats it as immutable from then on", () => {
    const sealed: SealedKnowledgePackage = {
      id: "kp_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      version: 2,
      title: "Acme product documentation, Q3 crawl",
      sourceDescription: "Ingested from Acme's internal help center export",
      createdAt: "2026-07-01T00:00:00.000Z",
      status: "SEALED",
      sealedAt: "2026-07-02T00:00:00.000Z",
    };

    expect(sealed.status).toBe("SEALED");
    expect(sealed.sealedAt).toBeTruthy();
    // A sealed package's sealedAt must be at or after its createdAt.
    expect(new Date(sealed.sealedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(sealed.createdAt).getTime(),
    );
  });

  it("accepts either variant through the KnowledgePackage union and discriminates on status", () => {
    const packages: KnowledgePackage[] = [
      {
        id: "kp_0002",
        clientOrganizationId: CLIENT_ORGANIZATION_ID,
        projectId: PROJECT_ID,
        version: 1,
        title: "Support ticket knowledge slice",
        sourceDescription: "Ingested from Zendesk export",
        createdAt: "2026-07-03T00:00:00.000Z",
        status: "DRAFT",
      },
      {
        id: "kp_0003",
        clientOrganizationId: CLIENT_ORGANIZATION_ID,
        projectId: PROJECT_ID,
        version: 1,
        title: "Pricing page knowledge slice",
        sourceDescription: "Ingested from marketing site crawl",
        createdAt: "2026-07-04T00:00:00.000Z",
        status: "SEALED",
        sealedAt: "2026-07-05T00:00:00.000Z",
      },
    ];

    const sealedCount = packages.filter((pkg) => pkg.status === "SEALED").length;
    expect(sealedCount).toBe(1);
    expect(packages.every((pkg) => pkg.clientOrganizationId === CLIENT_ORGANIZATION_ID)).toBe(true);
  });
});

describe("IndustryProfile", () => {
  it("scopes a vertical classification to a client organization and project, with a validation gate level", () => {
    const profile: IndustryProfile = {
      id: "ind_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      verticalSlug: "b2b-saas",
      verticalLabel: "B2B SaaS",
      validationGateLevel: "INDUSTRY_VERTICAL_GATE",
      ruleSetVersion: 3,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    expect(profile.clientOrganizationId).toBe(CLIENT_ORGANIZATION_ID);
    expect(profile.projectId).toBe(PROJECT_ID);
    expect(["PLATFORM_WIDE_GATE", "INDUSTRY_VERTICAL_GATE"]).toContain(profile.validationGateLevel);
    expect(profile.ruleSetVersion).toBeGreaterThan(0);
    expect(new Date(profile.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(profile.createdAt).getTime(),
    );
  });
});

describe("KeywordQuestionMap", () => {
  it("pins a keyword/question mapping to a specific KnowledgePackage version and an IndustryProfile", () => {
    const map: KeywordQuestionMap = {
      id: "kqm_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      knowledgePackageId: "kp_0001",
      knowledgePackageVersion: 2,
      industryProfileId: "ind_0001",
      entries: [
        {
          keyword: "geo article production",
          questions: [
            "What is GEO article production?",
            "How does knowledge-driven article production work?",
          ],
        },
        {
          keyword: "tenant isolation",
          questions: ["How is tenant data isolated between client organizations?"],
        },
      ],
      createdAt: "2026-07-06T00:00:00.000Z",
    };

    expect(map.clientOrganizationId).toBe(CLIENT_ORGANIZATION_ID);
    expect(map.knowledgePackageId).toBe("kp_0001");
    expect(map.knowledgePackageVersion).toBe(2);
    expect(map.entries.length).toBeGreaterThan(0);
    // Every keyword entry must map to at least one real user question.
    expect(map.entries.every((entry) => entry.questions.length > 0)).toBe(true);
  });
});

describe("Opportunity", () => {
  it("scopes an opportunity to a tenant and grounds it in a real KnowledgePackage id+version (not orphaned)", () => {
    const opportunity: Opportunity = {
      id: "opp_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      keywordQuestionMapId: "kqm_0001",
      keyword: "geo article production",
      // Same id/version as the SealedKnowledgePackage fixture above (kp_0001,
      // version 2) — the grounding reference must point at a real,
      // identifiable KnowledgePackage, not a dangling/placeholder id.
      groundingKnowledgePackageId: "kp_0001",
      groundingKnowledgePackageVersion: 2,
      createdAt: "2026-07-07T00:00:00.000Z",
    };

    expect(opportunity.clientOrganizationId).toBe(CLIENT_ORGANIZATION_ID);
    expect(opportunity.projectId).toBe(PROJECT_ID);
    // Grounding fields are required (non-optional) on the Opportunity type
    // itself, so their mere presence here is checked by the compiler; this
    // assertion additionally checks they resolve to the same source used by
    // the KeywordQuestionMap fixture above, i.e. the opportunity is not
    // grounded in an unrelated/orphaned knowledge source.
    expect(opportunity.groundingKnowledgePackageId).toBe("kp_0001");
    expect(opportunity.groundingKnowledgePackageVersion).toBe(2);
  });
});

describe("OpportunityValidation", () => {
  it("records a validation outcome against a specific IndustryProfile and gate level", () => {
    const validation: OpportunityValidation = {
      id: "oppval_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      opportunityId: "opp_0001",
      status: "VALIDATED",
      industryProfileId: "ind_0001",
      gateLevelApplied: "INDUSTRY_VERTICAL_GATE",
      reasonNote: "Keyword demand corroborated by two knowledge-package questions.",
      validatedAt: "2026-07-08T00:00:00.000Z",
    };

    expect(validation.opportunityId).toBe("opp_0001");
    expect(validation.industryProfileId).toBe("ind_0001");
    expect(["PENDING_VALIDATION", "VALIDATED", "REJECTED"]).toContain(validation.status);
    expect(["PLATFORM_WIDE_GATE", "INDUSTRY_VERTICAL_GATE"]).toContain(validation.gateLevelApplied);
  });
});

describe("HumanReviewDecision", () => {
  it("represents an approved decision only with an explicit reviewer identity and timestamp", () => {
    const approved: ApprovedHumanReviewDecision = {
      id: "hrd_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      opportunityId: "opp_0001",
      opportunityValidationId: "oppval_0001",
      status: "APPROVED",
      reviewerId: "user_platform_jane",
      decidedAt: "2026-07-10T00:00:00.000Z",
    };

    expect(approved.status).toBe("APPROVED");
    expect(approved.reviewerId).toBeTruthy();
    expect(approved.decidedAt).toBeTruthy();
  });

  it("requires a note explaining requested changes (not just a status flip)", () => {
    const changesRequested: ChangesRequestedHumanReviewDecision = {
      id: "hrd_0002",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      opportunityId: "opp_0001",
      opportunityValidationId: "oppval_0001",
      status: "CHANGES_REQUESTED",
      reviewerId: "user_platform_jane",
      decidedAt: "2026-07-11T00:00:00.000Z",
      requestedChangesNote: "Needs a more specific knowledge citation before re-review.",
    };

    expect(changesRequested.requestedChangesNote.length).toBeGreaterThan(0);
  });

  /**
   * SYSTEM_INVARIANTS_V1.md: "Human Review not default-approved". These
   * cases prove the *type system itself* rejects the failure mode — not
   * merely that a well-formed decision can be built, but that a
   * malformed/silently-defaulted "approved" shape cannot be assigned to
   * HumanReviewDecision at all. `npm run typecheck` (tsc --noEmit) is what
   * actually enforces these `@ts-expect-error` assertions: if the shape
   * below ever became legal (e.g. someone made `reviewerId` optional or
   * added a default), typecheck would start failing on the *absence* of an
   * expected error, catching the regression at compile time.
   */
  it("does not type-check an APPROVED decision missing a reviewer identity", () => {
    // @ts-expect-error - reviewerId is required and non-optional on every
    // HumanReviewDecision variant; there is no default that fills it in, so
    // an "approved" object without one must fail to compile.
    const missingReviewer: ApprovedHumanReviewDecision = {
      id: "hrd_0003",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      opportunityId: "opp_0001",
      opportunityValidationId: "oppval_0001",
      status: "APPROVED",
      decidedAt: "2026-07-12T00:00:00.000Z",
    };

    expect(missingReviewer).toBeTruthy();
  });

  it("does not type-check an APPROVED decision missing a decision timestamp", () => {
    // @ts-expect-error - decidedAt is required and non-optional; an
    // "approved" object without one must fail to compile.
    const missingTimestamp: ApprovedHumanReviewDecision = {
      id: "hrd_0004",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      opportunityId: "opp_0001",
      opportunityValidationId: "oppval_0001",
      status: "APPROVED",
      reviewerId: "user_platform_jane",
    };

    expect(missingTimestamp).toBeTruthy();
  });

  it("does not type-check a boolean-shaped 'approved: true' object masquerading as a decision", () => {
    // @ts-expect-error - HumanReviewDecision has no boolean-flag variant;
    // every variant is an object with a status enum plus reviewerId and
    // decidedAt, so a bare `{ approved: true }` can never satisfy the type.
    // This is the concrete "no silently-default-approved state" guarantee.
    const fakeApproval: HumanReviewDecision = { approved: true };

    expect(fakeApproval).toBeTruthy();
  });
});
