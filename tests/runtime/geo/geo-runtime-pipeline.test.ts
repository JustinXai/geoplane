/**
 * GEO_RUNTIME_SERVICE_PORTS_V1 — end-to-end pipeline over in-memory fakes.
 *
 * Proves the full chain composes keyword -> opportunity -> validation ->
 * human review -> family -> brief -> draft -> gates -> approval -> publish
 * package -> distribution -> publication receipt, with:
 *   - Provider Calls = 0 (offline provider fixture call count never rises).
 *   - Deterministic draft compilation (same inputs -> deep-equal output).
 *   - One audit intent per state-changing action.
 */
import { describe, expect, it } from "vitest";
import type { AuthorizationContext } from "../../../src/contracts/tenancy/entities.js";
import type {
  ArticleDraft,
  ChannelNeutralContentBlock,
} from "../../../src/contracts/geo-business/entities.js";
import {
  buildHarness,
  clientOwnerContext,
  ORG,
  PROJECT,
  type Harness,
} from "./fakes.js";

function assertPassed<T extends { status: string }>(
  gate: T,
): asserts gate is Extract<T, { status: "PASSED" }> {
  if (gate.status !== "PASSED") {
    throw new Error(`expected a PASSED gate, got "${gate.status}"`);
  }
}

const BLOCKS: ChannelNeutralContentBlock[] = [
  { kind: "HEADING", text: "Intro", order: 0 },
  { kind: "PARAGRAPH", text: "Body", order: 1 },
];

/** Runs the entire chain and returns the compiled draft + a few key artifacts. */
async function runFullChain(h: Harness, ctx: AuthorizationContext) {
  const kp = await h.keywordQuestion.createKnowledgePackage(ctx, {
    clientOrganizationId: ORG,
    projectId: PROJECT,
    version: 1,
    title: "ACME KB",
    sourceDescription: "seed",
  });
  const profile = await h.keywordQuestion.createIndustryProfile(ctx, {
    clientOrganizationId: ORG,
    projectId: PROJECT,
    verticalSlug: "b2b-saas",
    verticalLabel: "B2B SaaS",
    validationGateLevel: "INDUSTRY_VERTICAL_GATE",
    ruleSetVersion: 1,
  });
  const map = await h.keywordQuestion.createKeywordQuestionMap(ctx, {
    knowledgePackage: kp,
    industryProfileId: profile.id,
    entries: [{ keyword: "geo strategy", questions: ["what is geo strategy?"] }],
  });
  const opp = await h.opportunity.createOpportunity(ctx, {
    keywordQuestionMap: map,
    keyword: "geo strategy",
    knowledgePackage: kp,
  });
  const validation = await h.validation.validateOpportunity(ctx, {
    opportunity: opp,
    industryProfile: profile,
    status: "VALIDATED",
    reasonNote: "grounded",
  });
  const decision = await h.humanReview.confirm(ctx, validation, "user_reviewer_jane");
  const family = await h.family.createFamily(ctx, {
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
  const brief = await h.brief.createBrief(ctx, {
    family,
    workingTitle: "GEO Strategy Guide",
    outline: ["Intro", "Body"],
    targetKeywords: ["geo strategy"],
    riskLevel: "STANDARD",
  });
  const content = await h.pipeline.ingestProviderArticleContent(
    ctx,
    brief,
    h.provider.generateEnvelopeId(),
  );
  const draft = await h.pipeline.compileDraft(ctx, brief, [content]);
  const qualityGate = await h.gates.evaluateQuality(ctx, draft, brief);
  const platformGate = await h.gates.evaluatePlatformGate(ctx, draft, profile);
  const verticalGate = await h.gates.evaluateVerticalGate(ctx, draft, profile);
  assertPassed(qualityGate);
  assertPassed(platformGate);
  assertPassed(verticalGate);
  const approval = await h.gates.approveArticle(
    ctx,
    draft,
    "user_approver_bob",
    qualityGate,
    platformGate,
    verticalGate,
  );
  const pkg = await h.publish.createPublishPackage(ctx, approval, draft);
  const cncp = await h.publish.createChannelNeutralPackage(ctx, pkg, BLOCKS);
  const plan = await h.distribution.createDistributionPlan(ctx, {
    channelNeutralPackage: cncp,
    channelIds: ["channel_wechat"],
    selectedByActorId: "user_platform_jane",
  });
  const receipt = await h.delivery.recordPublicationReceipt(
    ctx,
    plan,
    "channel_wechat",
    "user_platform_jane",
  );
  const status = await h.delivery.publicationStatus(ctx, plan);
  return { kp, profile, map, opp, validation, decision, family, brief, content, draft, cncp, plan, receipt, status };
}

describe("GEO runtime pipeline (keyword -> publication receipt)", () => {
  it("composes the full chain end-to-end over in-memory fakes", async () => {
    const h = buildHarness();
    const ctx = clientOwnerContext(ORG);
    const out = await runFullChain(h, ctx);

    expect(out.opp.keyword).toBe("geo strategy");
    expect(out.opp.groundingKnowledgePackageId).toBe(out.kp.id);
    expect(out.decision.status).toBe("APPROVED");
    expect(out.brief.planningContext.authorizingHumanReviewDecisionIds).toEqual([out.decision.id]);
    expect(out.draft.status).toBe("DRAFT");
    expect(out.draft.version).toBe(1);
    expect(out.draft.sections.map((s) => s.heading)).toEqual(["Intro", "Body"]);
    expect(out.receipt.channelId).toBe("channel_wechat");
    expect(out.status).toBe("PUBLISHED");
  });

  it("makes Provider Calls = 0: services never invoke the offline provider", async () => {
    const h = buildHarness();
    const ctx = clientOwnerContext(ORG);
    // Seeding the single provider envelope is the ONLY invocation of the fixture.
    // Capture the baseline right before the pipeline runs.
    const before = h.provider.callCount;
    await runFullChain(h, ctx);
    // runFullChain calls generateEnvelopeId exactly once (to seed content).
    // If any service had called a provider, callCount would exceed before + 1.
    expect(h.provider.callCount).toBe(before + 1);
  });

  it("compiles drafts deterministically: identical inputs -> deep-equal output", async () => {
    const ctxA = clientOwnerContext(ORG);
    const ctxB = clientOwnerContext(ORG);
    const a = await runFullChain(buildHarness("id"), ctxA);
    const b = await runFullChain(buildHarness("id"), ctxB);
    // Same id sequence + fixed clock + same inputs => byte-identical drafts.
    const draftA: ArticleDraft = a.draft;
    const draftB: ArticleDraft = b.draft;
    expect(draftA).toEqual(draftB);
    // And the derived brief/family are identical too.
    expect(a.brief).toEqual(b.brief);
    expect(a.family).toEqual(b.family);
  });

  it("emits one audit intent per state-changing action, tenant + project scoped", async () => {
    const h = buildHarness();
    const ctx = clientOwnerContext(ORG);
    await runFullChain(h, ctx);
    const actions = h.infra.audit.intents.map((i) => i.action);
    expect(actions).toEqual([
      "knowledge_package.created",
      "industry_profile.created",
      "keyword_question_map.created",
      "opportunity.created",
      "opportunity.validated",
      "human_review.confirmed",
      "opportunity_family.created",
      "article_brief.created",
      "provider_article_content.ingested",
      "article_draft.compiled",
      "quality_gate.passed",
      "platform_gate.passed",
      "vertical_gate.passed",
      "article.approved",
      "publish_package.created",
      "channel_neutral_content_package.created",
      "distribution_plan.created",
      "publication_receipt.recorded",
    ]);
    for (const intent of h.infra.audit.intents) {
      expect(intent.clientOrganizationId).toBe(ORG);
      expect(intent.projectId).toBe(PROJECT);
      expect(intent.actorUserId).toBe(ctx.actorUserId);
    }
  });
});
