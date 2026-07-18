/**
 * GEO_RUNTIME_SERVICE_PORTS_V1 — invariant enforcement over in-memory fakes.
 *
 * Proves the non-negotiable invariants of the GEO business chain hold at the
 * service layer:
 *   - Human review is never auto-approved (no silent-approve path).
 *   - Gates must pass before an ArticleApproval can be built (structural).
 *   - PublishPackage / ChannelNeutralContentPackage default channel count = 0.
 *   - PublicationReceipt rejects a system/automatic actor id.
 *   - Cross-tenant access is rejected (fail-closed authorization).
 *   - Historical artifacts are never mutated (append-only repositories).
 */
import { describe, expect, it } from "vitest";
import { AuthorizationDeniedError } from "../../../src/contracts/tenancy/authorization.js";
import type {
  ArticleBrief,
  ArticleDraft,
  IndustryProfile,
  KnowledgePackage,
  OpportunityFamily,
} from "../../../src/contracts/geo-business/entities.js";
import {
  buildHarness,
  clientOwnerContext,
  ORG,
  PROJECT,
  type Harness,
} from "./fakes.js";
import type { AuthorizationContext } from "../../../src/contracts/tenancy/entities.js";

const ctx = (): AuthorizationContext => clientOwnerContext(ORG);

/** Builds an APPROVED family + brief ready for downstream steps. */
async function seedApprovedBrief(
  h: Harness,
  actor: AuthorizationContext,
): Promise<{ kp: KnowledgePackage; profile: IndustryProfile; family: OpportunityFamily; brief: ArticleBrief }> {
  const kp = await h.keywordQuestion.createKnowledgePackage(actor, {
    clientOrganizationId: ORG,
    projectId: PROJECT,
    version: 1,
    title: "KB",
    sourceDescription: "seed",
  });
  const profile = await h.keywordQuestion.createIndustryProfile(actor, {
    clientOrganizationId: ORG,
    projectId: PROJECT,
    verticalSlug: "b2b-saas",
    verticalLabel: "B2B SaaS",
    validationGateLevel: "INDUSTRY_VERTICAL_GATE",
    ruleSetVersion: 1,
  });
  const map = await h.keywordQuestion.createKeywordQuestionMap(actor, {
    knowledgePackage: kp,
    industryProfileId: profile.id,
    entries: [{ keyword: "k1", questions: ["q1"] }],
  });
  const opp = await h.opportunity.createOpportunity(actor, {
    keywordQuestionMap: map,
    keyword: "k1",
    knowledgePackage: kp,
  });
  const validation = await h.validation.validateOpportunity(actor, {
    opportunity: opp,
    industryProfile: profile,
    status: "VALIDATED",
    reasonNote: "ok",
  });
  const decision = await h.humanReview.confirm(actor, validation, "user_reviewer_jane");
  const family = await h.family.createFamily(actor, {
    clientOrganizationId: ORG,
    projectId: PROJECT,
    members: [
      {
        opportunityId: opp.id,
        authorizingHumanReviewDecisionId: decision.id,
        authorizingReviewDecisionStatus: "APPROVED",
      },
    ],
  });
  const brief = await h.brief.createBrief(actor, {
    family,
    workingTitle: "Guide",
    outline: ["Intro", "Body"],
    targetKeywords: ["k1"],
    riskLevel: "STANDARD",
  });
  return { kp, profile, family, brief };
}

async function compileDraftFor(
  h: Harness,
  actor: AuthorizationContext,
  brief: ArticleBrief,
): Promise<ArticleDraft> {
  const content = await h.pipeline.ingestProviderArticleContent(
    actor,
    brief,
    h.provider.generateEnvelopeId(),
  );
  return h.pipeline.compileDraft(actor, brief, [content]);
}

describe("Invariant: human review is never auto-approved", () => {
  it("requires a non-empty reviewer id to confirm (no silent approve)", async () => {
    const h = buildHarness();
    const actor = ctx();
    const kp = await h.keywordQuestion.createKnowledgePackage(actor, {
      clientOrganizationId: ORG,
      projectId: PROJECT,
      version: 1,
      title: "KB",
      sourceDescription: "seed",
    });
    const profile = await h.keywordQuestion.createIndustryProfile(actor, {
      clientOrganizationId: ORG,
      projectId: PROJECT,
      verticalSlug: "v",
      verticalLabel: "V",
      validationGateLevel: "PLATFORM_WIDE_GATE",
      ruleSetVersion: 1,
    });
    const map = await h.keywordQuestion.createKeywordQuestionMap(actor, {
      knowledgePackage: kp,
      industryProfileId: profile.id,
      entries: [{ keyword: "k1", questions: ["q1"] }],
    });
    const opp = await h.opportunity.createOpportunity(actor, {
      keywordQuestionMap: map,
      keyword: "k1",
      knowledgePackage: kp,
    });
    const validation = await h.validation.validateOpportunity(actor, {
      opportunity: opp,
      industryProfile: profile,
      status: "VALIDATED",
      reasonNote: "ok",
    });
    await expect(h.humanReview.confirm(actor, validation, "   ")).rejects.toThrow(/reviewerId/);
  });

  it("rejects a family whose member cites a non-APPROVED decision", async () => {
    const h = buildHarness();
    const actor = ctx();
    const kp = await h.keywordQuestion.createKnowledgePackage(actor, {
      clientOrganizationId: ORG,
      projectId: PROJECT,
      version: 1,
      title: "KB",
      sourceDescription: "seed",
    });
    const profile = await h.keywordQuestion.createIndustryProfile(actor, {
      clientOrganizationId: ORG,
      projectId: PROJECT,
      verticalSlug: "v",
      verticalLabel: "V",
      validationGateLevel: "PLATFORM_WIDE_GATE",
      ruleSetVersion: 1,
    });
    const map = await h.keywordQuestion.createKeywordQuestionMap(actor, {
      knowledgePackage: kp,
      industryProfileId: profile.id,
      entries: [{ keyword: "k1", questions: ["q1"] }],
    });
    const opp = await h.opportunity.createOpportunity(actor, {
      keywordQuestionMap: map,
      keyword: "k1",
      knowledgePackage: kp,
    });
    const validation = await h.validation.validateOpportunity(actor, {
      opportunity: opp,
      industryProfile: profile,
      status: "VALIDATED",
      reasonNote: "ok",
    });
    // A CHANGES_REQUESTED decision is a real decision — but not an approval.
    const changes = await h.humanReview.requestChanges(
      actor,
      validation,
      "user_reviewer_jane",
      "please add sources",
    );
    // The frozen member type pins status to "APPROVED", so we forge the member
    // via a cast to simulate a boundary value arriving from deserialized JSON.
    // The service's runtime guard must still reject it.
    const forgedMember = {
      opportunityId: opp.id,
      authorizingHumanReviewDecisionId: changes.id,
      authorizingReviewDecisionStatus: "APPROVED",
    } as OpportunityFamily["members"][number];
    await expect(
      h.family.createFamily(actor, {
        clientOrganizationId: ORG,
        projectId: PROJECT,
        members: [forgedMember],
      }),
    ).rejects.toThrow(/not "APPROVED"|does not exist/);
  });
});

describe("Invariant: gates must pass before approval", () => {
  it("produces a FAILED quality gate for a draft with blank-heading sections", async () => {
    const h = buildHarness();
    const actor = ctx();
    const { brief } = await seedApprovedBrief(h, actor);
    // A brief whose outline has a blank heading -> draft with a blank section.
    const blankBrief: ArticleBrief = { ...brief, outline: ["   "] };
    const content = await h.pipeline.ingestProviderArticleContent(
      actor,
      blankBrief,
      h.provider.generateEnvelopeId(),
    );
    const draft = await h.pipeline.compileDraft(actor, blankBrief, [content]);
    const gate = await h.gates.evaluateQuality(actor, draft, blankBrief);
    expect(gate.status).toBe("FAILED");
    if (gate.status === "FAILED") {
      expect(gate.failureReasons.length).toBeGreaterThan(0);
      // @ts-expect-error a FAILED gate is not assignable where a PASSED gate is required
      await h.gates.approveArticle(actor, draft, "user_approver_bob", gate, gate, gate);
    }
  });

  it("builds an ArticleApproval only from three PASSED gates", async () => {
    const h = buildHarness();
    const actor = ctx();
    const { profile, brief } = await seedApprovedBrief(h, actor);
    const draft = await compileDraftFor(h, actor, brief);
    const q = await h.gates.evaluateQuality(actor, draft, brief);
    const p = await h.gates.evaluatePlatformGate(actor, draft, profile);
    const v = await h.gates.evaluateVerticalGate(actor, draft, profile);
    if (q.status !== "PASSED" || p.status !== "PASSED" || v.status !== "PASSED") {
      throw new Error("expected all three gates to pass for a well-formed draft");
    }
    const approval = await h.gates.approveArticle(actor, draft, "user_approver_bob", q, p, v);
    expect(approval.qualityGateStatus).toBe("PASSED");
    expect(approval.platformGateStatus).toBe("PASSED");
    expect(approval.verticalGateStatus).toBe("PASSED");
    expect(approval.approverId).toBe("user_approver_bob");
  });
});

describe("Invariant: default selected channel count = 0", () => {
  it("creates a channel-neutral package with zero target channels, growable only explicitly", async () => {
    const h = buildHarness();
    const actor = ctx();
    const { profile, brief } = await seedApprovedBrief(h, actor);
    const draft = await compileDraftFor(h, actor, brief);
    const q = await h.gates.evaluateQuality(actor, draft, brief);
    const p = await h.gates.evaluatePlatformGate(actor, draft, profile);
    const v = await h.gates.evaluateVerticalGate(actor, draft, profile);
    if (q.status !== "PASSED" || p.status !== "PASSED" || v.status !== "PASSED") {
      throw new Error("expected all gates to pass");
    }
    const approval = await h.gates.approveArticle(actor, draft, "user_approver_bob", q, p, v);
    const pkg = await h.publish.createPublishPackage(actor, approval, draft);
    const cncp = await h.publish.createChannelNeutralPackage(actor, pkg, [
      { kind: "HEADING", text: "Intro", order: 0 },
    ]);
    expect(cncp.targetChannelIds).toEqual([]);
    // Explicit, one-at-a-time selection grows an in-memory copy, never the stored base.
    const withOne = h.publish.selectTargetChannel(cncp, "channel_a");
    expect(withOne.targetChannelIds).toEqual(["channel_a"]);
    expect(cncp.targetChannelIds).toEqual([]); // base package unchanged
  });
});

describe("Invariant: publication receipt rejects a system/automatic actor", () => {
  it("throws when publishedByActorId is an automatic/system id", async () => {
    const h = buildHarness();
    const actor = ctx();
    const { profile, brief } = await seedApprovedBrief(h, actor);
    const draft = await compileDraftFor(h, actor, brief);
    const q = await h.gates.evaluateQuality(actor, draft, brief);
    const p = await h.gates.evaluatePlatformGate(actor, draft, profile);
    const v = await h.gates.evaluateVerticalGate(actor, draft, profile);
    if (q.status !== "PASSED" || p.status !== "PASSED" || v.status !== "PASSED") {
      throw new Error("expected all gates to pass");
    }
    const approval = await h.gates.approveArticle(actor, draft, "user_approver_bob", q, p, v);
    const pkg = await h.publish.createPublishPackage(actor, approval, draft);
    const cncp = await h.publish.createChannelNeutralPackage(actor, pkg, [
      { kind: "HEADING", text: "Intro", order: 0 },
    ]);
    const plan = await h.distribution.createDistributionPlan(actor, {
      channelNeutralPackage: cncp,
      channelIds: ["channel_a"],
      selectedByActorId: "user_platform_jane",
    });
    await expect(
      h.delivery.recordPublicationReceipt(actor, plan, "channel_a", "system"),
    ).rejects.toThrow(/automatic|system/i);
    // A real human actor succeeds.
    const receipt = await h.delivery.recordPublicationReceipt(
      actor,
      plan,
      "channel_a",
      "user_platform_jane",
    );
    expect(receipt.publishedByActorId).toBe("user_platform_jane");
  });
});

describe("Invariant: cross-tenant access is rejected", () => {
  it("denies a CLIENT_OWNER creating data for a different client org", async () => {
    const h = buildHarness();
    const actorForA = clientOwnerContext("org_client_a");
    await expect(
      h.keywordQuestion.createKnowledgePackage(actorForA, {
        clientOrganizationId: "org_client_b",
        projectId: "proj_b",
        version: 1,
        title: "KB",
        sourceDescription: "seed",
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("denies acting on an artifact belonging to another tenant", async () => {
    const h = buildHarness();
    const actorA = clientOwnerContext(ORG);
    const { brief } = await seedApprovedBrief(h, actorA);
    // A different tenant's owner cannot ingest content against tenant A's brief.
    const actorB = clientOwnerContext("org_client_other");
    await expect(
      h.pipeline.ingestProviderArticleContent(actorB, brief, "offline_env"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});

describe("Invariant: historical artifacts are never mutated (append-only)", () => {
  it("compiling again appends a new versioned draft rather than mutating the first", async () => {
    const h = buildHarness();
    const actor = ctx();
    const { brief } = await seedApprovedBrief(h, actor);
    const content = await h.pipeline.ingestProviderArticleContent(
      actor,
      brief,
      h.provider.generateEnvelopeId(),
    );
    const v1 = await h.pipeline.compileDraft(actor, brief, [content]);
    const v2 = await h.pipeline.compileDraft(actor, brief, [content]);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.id).not.toBe(v2.id); // a new record, never an overwrite
  });

  it("the append-only repository refuses to overwrite an existing id", async () => {
    const h = buildHarness();
    const actor = ctx();
    const kp = await h.keywordQuestion.createKnowledgePackage(actor, {
      clientOrganizationId: ORG,
      projectId: PROJECT,
      version: 1,
      title: "KB",
      sourceDescription: "seed",
    });
    // Re-adding the same record id must be rejected by the fake's append-only guard.
    const repo = new (await import("./fakes.js")).FakeKnowledgePackageRepository();
    await repo.add(kp);
    await expect(repo.add(kp)).rejects.toThrow(/append-only|overwrite/i);
  });
});
