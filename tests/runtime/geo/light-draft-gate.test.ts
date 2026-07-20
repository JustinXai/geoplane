/**
 * Focused tests for LightDraftGateService.
 *
 * Tests the light gate evaluation for ArticleDrafts with three verdicts:
 *   - PASS: draft passes all checks
 *   - REPAIR: draft has repairable issues
 *   - REJECT: draft has hard risk issues
 *
 * Also tests the human review flow for drafts.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { ArticleDraft, DraftArticleDraft } from "../../../src/contracts/geo-business/entities.js";
import { makeInfra, clientOwnerContext, ORG, PROJECT, buildHarness } from "./fakes.js";
import { LightDraftGateService } from "../../../src/runtime/geo/services/light-draft-gate-service.js";
import { DraftReviewService } from "../../../src/runtime/geo/services/draft-review-service.js";
import { FakeArticleDraftRepository, FakeHumanReviewRepository } from "./fakes.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A well-formed draft that should pass the light gate. */
function makeGoodDraft(overrides: Partial<ArticleDraft> = {}): ArticleDraft {
  const draft: ArticleDraft = {
    id: "draft_good_1",
    clientOrganizationId: ORG,
    projectId: PROJECT,
    articleBriefId: "brief_1",
    sourceProviderArticleContentIds: ["content_1", "content_2"],
    version: 1,
    title: "人工智能在企业数字化转型中的应用",
    sections: [
      { heading: "核心观点总结", order: 0 },
      { heading: "人工智能技术概述", order: 1 },
      { heading: "企业应用场景分析", order: 2 },
    ],
    status: "DRAFT",
    compiledAt: "2026-01-01T00:00:00.000Z",
  };
  return Object.assign(Object.create(Object.getPrototypeOf(draft)), draft, overrides) as ArticleDraft;
}

/** A draft with repairable issues. */
function makeRepairableDraft(): DraftArticleDraft {
  return {
    id: "draft_repairable_1",
    clientOrganizationId: ORG,
    projectId: PROJECT,
    articleBriefId: "brief_1",
    sourceProviderArticleContentIds: ["content_1"],
    version: 1,
    title: "AI",
    sections: [
      { heading: "导言", order: 0 },
      { heading: "某公司介绍", order: 1 },
      { heading: "AI应用", order: 2 },
      { heading: "AI应用", order: 3 },
      { heading: "AI应用", order: 4 },
    ],
    status: "DRAFT",
    compiledAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A draft with hard risk issues. */
function makeHardRiskDraft(): DraftArticleDraft {
  return {
    id: "draft_hard_risk_1",
    clientOrganizationId: ORG,
    projectId: PROJECT,
    articleBriefId: "brief_1",
    sourceProviderArticleContentIds: ["content_1"],
    version: 1,
    title: "解决方案介绍",
    sections: [],
    status: "DRAFT",
    compiledAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// LightDraftGateService tests
// ---------------------------------------------------------------------------

describe("LightDraftGateService", () => {
  let infra: ReturnType<typeof makeInfra>;
  let actor: ReturnType<typeof clientOwnerContext>;
  let service: LightDraftGateService;

  beforeEach(() => {
    infra = makeInfra();
    actor = clientOwnerContext(ORG);
    service = new LightDraftGateService(infra);
  });

  describe("PASS verdict", () => {
    it("should return PASS for a well-formed draft", () => {
      const draft = makeGoodDraft();
      const result = service.evaluate(actor, draft);

      expect(result.verdict).toBe("PASS");
      expect(result.issues).toHaveLength(0);
      expect(result.repairedDraft).toBeUndefined();
    });

    it("should return PASS with warnings for minor issues", () => {
      const draft = makeGoodDraft({
        sections: [
          { heading: "导言", order: 0 }, // Intro first - warning only
          { heading: "核心观点", order: 1 },
          { heading: "详细内容", order: 2 },
        ],
      });
      const result = service.evaluate(actor, draft);

      expect(result.verdict).toBe("PASS");
      expect(result.issues.some((i) => i.severity === "WARNING")).toBe(true);
    });

    it("should return PASS for SEALED drafts", () => {
      const draft = makeGoodDraft();
      const sealedDraft = { ...draft, status: "SEALED" as const };
      const result = service.evaluate(actor, sealedDraft);

      expect(result.verdict).toBe("PASS");
    });
  });

  describe("REPAIR verdict", () => {
    it("should return REPAIR for drafts with repairable issues", () => {
      const draft = makeRepairableDraft();
      const result = service.evaluate(actor, draft);

      expect(result.verdict).toBe("REPAIR");
      expect(result.issues.some((i) => i.severity === "REPAIRABLE")).toBe(true);
      expect(result.repairedDraft).toBeDefined();
    });

    it("should generate repaired draft with incremented version", () => {
      const draft = makeRepairableDraft();
      const result = service.evaluate(actor, draft);

      expect(result.repairedDraft).toBeDefined();
      expect(result.repairedDraft!.version).toBe(draft.version + 1);
      expect(result.repairedDraft!.id).not.toBe(draft.id);
    });

    it("should fix vague entity references in repaired draft", () => {
      const draft = makeRepairableDraft();
      const result = service.evaluate(actor, draft);

      const repairedSections = result.repairedDraft!.sections;
      const vagueSection = repairedSections.find((s) => s.order === 1);
      expect(vagueSection!.heading).toContain("[具体实体名称]");
    });

    it("should fix keyword stuffing in repaired draft", () => {
      const draft = makeRepairableDraft();
      const result = service.evaluate(actor, draft);

      const repairedSections = result.repairedDraft!.sections;
      // After repair, headings should be more varied
      const uniqueHeadings = new Set(repairedSections.map((s) => s.heading));
      expect(uniqueHeadings.size).toBeGreaterThan(1);
    });

    it("should return PASS (not REPAIR) for WARNING-only issues", () => {
      const draft = makeGoodDraft({
        sections: [
          { heading: "导言", order: 0 }, // Warning only
          { heading: "核心观点", order: 1 },
          { heading: "详细内容", order: 2 },
        ],
      });
      const result = service.evaluate(actor, draft);

      expect(result.verdict).toBe("PASS");
      expect(result.repairedDraft).toBeUndefined();
    });
  });

  describe("REJECT verdict", () => {
    it("should return REJECT for draft with no sections", () => {
      const draft = makeHardRiskDraft();
      const result = service.evaluate(actor, draft);

      expect(result.verdict).toBe("REJECT");
      expect(result.issues.some((i) => i.severity === "HARMFUL")).toBe(true);
      expect(result.repairedDraft).toBeUndefined();
    });

    it("should not generate repaired draft for REJECT verdict", () => {
      const draft = makeHardRiskDraft();
      const result = service.evaluate(actor, draft);

      expect(result.repairedDraft).toBeUndefined();
    });
  });

  describe("check items", () => {
    it("should detect fabricated statistics patterns", () => {
      const draft = makeGoodDraft({
        sections: [
          { heading: "30%增长率分析", order: 0 },
          { heading: "排名靠前", order: 1 },
          { heading: "相关内容", order: 2 },
        ],
      });
      const result = service.evaluate(actor, draft);

      const fabricatedIssues = result.issues.filter((i) => i.category === "FABRICATED_CONTENT");
      expect(fabricatedIssues.length).toBeGreaterThan(0);
    });

    it("should detect absolute claims", () => {
      const draft = makeGoodDraft({
        sections: [
          { heading: "最佳解决方案", order: 0 },
          { heading: "相关内容", order: 1 },
          { heading: "详细内容", order: 2 },
        ],
      });
      const result = service.evaluate(actor, draft);

      const absoluteIssues = result.issues.filter((i) => i.category === "ABSOLUTE_CLAIMS");
      expect(absoluteIssues.length).toBeGreaterThan(0);
    });

    it("should detect English-only headings as warning", () => {
      const draft = makeGoodDraft({
        sections: [
          { heading: "Introduction", order: 0 },
          { heading: "Overview", order: 1 },
          { heading: "详细内容", order: 2 },
        ],
      });
      const result = service.evaluate(actor, draft);

      const aiCompatIssues = result.issues.filter(
        (i) => i.category === "DOMESTIC_AI_COMPATIBILITY",
      );
      expect(aiCompatIssues.some((i) => i.severity === "WARNING")).toBe(true);
    });
  });

  describe("evaluateAndRepair", () => {
    it("should persist repaired draft when repository is provided", async () => {
      const repo = new FakeArticleDraftRepository();
      const serviceWithRepo = new LightDraftGateService(infra, repo);
      const draft = makeRepairableDraft();

      const result = await serviceWithRepo.evaluateAndRepair(actor, draft);

      expect(result.verdict).toBe("REPAIR");
      expect(result.repairedDraft).toBeDefined();
      expect(result.repairedDraft!.id).toBe("id_1"); // From SequentialIdFactory

      // Verify the draft was persisted
      const persisted = await repo.getById("id_1");
      expect(persisted).toBeDefined();
      expect(persisted!.id).toBe("id_1");
    });

    it("should throw when REPAIR verdict but no repository", async () => {
      const draft = makeRepairableDraft();

      await expect(service.evaluateAndRepair(actor, draft)).rejects.toThrow(
        "repository not provided",
      );
    });

    it("should emit audit event for repaired draft", async () => {
      const repo = new FakeArticleDraftRepository();
      const serviceWithRepo = new LightDraftGateService(infra, repo);
      const draft = makeRepairableDraft();

      await serviceWithRepo.evaluateAndRepair(actor, draft);

      expect(infra.audit.intents.length).toBe(1);
      expect(infra.audit.intents[0]!.action).toBe("draft.repaired");
    });
  });

  describe("tenant isolation", () => {
    it("should throw when actor cannot access draft tenant", () => {
      const wrongOrgActor = clientOwnerContext("org_other");
      const draft = makeGoodDraft();

      expect(() => service.evaluate(wrongOrgActor, draft)).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// DraftReviewService tests
// ---------------------------------------------------------------------------

describe("DraftReviewService", () => {
  let infra: ReturnType<typeof makeInfra>;
  let actor: ReturnType<typeof clientOwnerContext>;
  let draftRepo: FakeArticleDraftRepository;
  let reviewRepo: FakeHumanReviewRepository;
  let service: DraftReviewService;

  beforeEach(() => {
    infra = makeInfra();
    actor = clientOwnerContext(ORG);
    draftRepo = new FakeArticleDraftRepository();
    reviewRepo = new FakeHumanReviewRepository();
    service = new DraftReviewService(reviewRepo, draftRepo, infra);
  });

  describe("APPROVED decision", () => {
    it("should record APPROVED human review decision", async () => {
      const draft = makeGoodDraft();

      const result = await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "APPROVED",
        reviewerId: "reviewer_jane",
      });

      expect(result.decision.status).toBe("APPROVED");
      expect(result.decision.reviewerId).toBe("reviewer_jane");
      expect(result.decision.opportunityId).toBe(draft.id); // Draft id stored as opportunityId
    });

    it("should persist the review decision", async () => {
      const draft = makeGoodDraft();

      const result = await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "APPROVED",
        reviewerId: "reviewer_jane",
      });

      const stored = await reviewRepo.getById(result.decision.id);
      expect(stored).toBeDefined();
      expect(stored!.status).toBe("APPROVED");
    });

    it("should emit audit event for APPROVED", async () => {
      const draft = makeGoodDraft();

      await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "APPROVED",
        reviewerId: "reviewer_jane",
      });

      expect(infra.audit.intents[0]!.action).toBe("draft_review.approved");
    });
  });

  describe("RETURNED decision", () => {
    it("should record RETURNED (CHANGES_REQUESTED) human review decision", async () => {
      const draft = makeGoodDraft();

      const result = await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "RETURNED",
        reviewerId: "reviewer_john",
        note: "Please fix the title",
      });

      expect(result.decision.status).toBe("CHANGES_REQUESTED");
      expect((result.decision as any).requestedChangesNote).toBe("Please fix the title");
    });

    it("should use default note when not provided", async () => {
      const draft = makeGoodDraft();

      const result = await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "RETURNED",
        reviewerId: "reviewer_john",
      });

      expect(result.decision.status).toBe("CHANGES_REQUESTED");
      expect((result.decision as any).requestedChangesNote).toBe("Draft returned for revision.");
    });

    it("should emit audit event for RETURNED", async () => {
      const draft = makeGoodDraft();

      await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "RETURNED",
        reviewerId: "reviewer_john",
        note: "Needs revision",
      });

      expect(infra.audit.intents[0]!.action).toBe("draft_review.returned");
    });
  });

  describe("REJECTED decision", () => {
    it("should record REJECTED human review decision", async () => {
      const draft = makeGoodDraft();

      const result = await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "REJECTED",
        reviewerId: "reviewer_admin",
        note: "Does not meet quality standards",
      });

      expect(result.decision.status).toBe("REJECTED");
      expect((result.decision as any).rejectionReasonNote).toBe("Does not meet quality standards");
    });

    it("should use default note when not provided", async () => {
      const draft = makeGoodDraft();

      const result = await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "REJECTED",
        reviewerId: "reviewer_admin",
      });

      expect(result.decision.status).toBe("REJECTED");
      expect((result.decision as any).rejectionReasonNote).toBe("Draft rejected.");
    });

    it("should emit audit event for REJECTED", async () => {
      const draft = makeGoodDraft();

      await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "REJECTED",
        reviewerId: "reviewer_admin",
        note: "Rejected",
      });

      expect(infra.audit.intents[0]!.action).toBe("draft_review.rejected");
    });
  });

  describe("validation", () => {
    it("should throw when reviewerId is empty", async () => {
      const draft = makeGoodDraft();

      await expect(
        service.decide(actor, draft, {
          articleDraftId: draft.id,
          decision: "APPROVED",
          reviewerId: "",
        }),
      ).rejects.toThrow("real, non-empty reviewerId is required");
    });

    it("should throw when draft is not in DRAFT status", async () => {
      const draft = makeGoodDraft({ status: "SEALED" });

      await expect(
        service.decide(actor, draft, {
          articleDraftId: draft.id,
          decision: "APPROVED",
          reviewerId: "reviewer_jane",
        }),
      ).rejects.toThrow("only DRAFT drafts may be reviewed");
    });

    it("should throw when actor cannot access draft tenant", async () => {
      const wrongOrgActor = clientOwnerContext("org_other");
      const draft = makeGoodDraft();

      await expect(
        service.decide(wrongOrgActor, draft, {
          articleDraftId: draft.id,
          decision: "APPROVED",
          reviewerId: "reviewer_jane",
        }),
      ).rejects.toThrow();
    });
  });

  describe("tenant isolation", () => {
    it("should include tenant scope in decision", async () => {
      const draft = makeGoodDraft();

      const result = await service.decide(actor, draft, {
        articleDraftId: draft.id,
        decision: "APPROVED",
        reviewerId: "reviewer_jane",
      });

      expect(result.decision.clientOrganizationId).toBe(ORG);
      expect(result.decision.projectId).toBe(PROJECT);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: Light Gate -> Human Review flow
// ---------------------------------------------------------------------------

describe("Light Gate -> Human Review flow", () => {
  let infra: ReturnType<typeof makeInfra>;
  let actor: ReturnType<typeof clientOwnerContext>;
  let draftRepo: FakeArticleDraftRepository;
  let reviewRepo: FakeHumanReviewRepository;

  beforeEach(() => {
    infra = makeInfra();
    actor = clientOwnerContext(ORG);
    draftRepo = new FakeArticleDraftRepository();
    reviewRepo = new FakeHumanReviewRepository();
  });

  it("should support PASS -> APPROVED flow", async () => {
    const draft = makeGoodDraft();
    const gateService = new LightDraftGateService(infra);
    const reviewService = new DraftReviewService(reviewRepo, draftRepo, infra);

    // Step 1: Light gate evaluation
    const gateResult = gateService.evaluate(actor, draft);
    expect(gateResult.verdict).toBe("PASS");

    // Step 2: Human review approves
    const reviewResult = await reviewService.decide(actor, draft, {
      articleDraftId: draft.id,
      decision: "APPROVED",
      reviewerId: "reviewer_jane",
    });

    expect(reviewResult.decision.status).toBe("APPROVED");
  });

  it("should support REPAIR -> RETURNED flow", async () => {
    const draft = makeRepairableDraft();
    const gateService = new LightDraftGateService(infra, draftRepo);
    const reviewService = new DraftReviewService(reviewRepo, draftRepo, infra);

    // Step 1: Light gate evaluation with repair
    const gateResult = await gateService.evaluateAndRepair(actor, draft);
    expect(gateResult.verdict).toBe("REPAIR");
    expect(gateResult.repairedDraft).toBeDefined();

    // Step 2: Human review returns for further revision
    const reviewResult = await reviewService.decide(actor, draft, {
      articleDraftId: draft.id,
      decision: "RETURNED",
      reviewerId: "reviewer_john",
      note: "Please address remaining issues",
    });

    expect(reviewResult.decision.status).toBe("CHANGES_REQUESTED");
    expect((reviewResult.decision as any).requestedChangesNote).toBe("Please address remaining issues");
  });

  it("should support REJECT -> REJECTED flow", async () => {
    const draft = makeHardRiskDraft();
    const gateService = new LightDraftGateService(infra);
    const reviewService = new DraftReviewService(reviewRepo, draftRepo, infra);

    // Step 1: Light gate evaluation
    const gateResult = gateService.evaluate(actor, draft);
    expect(gateResult.verdict).toBe("REJECT");
    expect(gateResult.repairedDraft).toBeUndefined();

    // Step 2: Human review rejects
    const reviewResult = await reviewService.decide(actor, draft, {
      articleDraftId: draft.id,
      decision: "REJECTED",
      reviewerId: "reviewer_admin",
      note: "Cannot be approved in current form",
    });

    expect(reviewResult.decision.status).toBe("REJECTED");
  });
});
