/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/geo-business/entities.ts (D1-D6 pure types and
 *   pure transformation functions), src/contracts/tenancy/authorization.ts (B2 -
 *   assertCanAccessClientOrganization, the fail-closed tenant-isolation check every
 *   mutation below is gated on), src/contracts/tenancy/in-memory-repository.ts (B5's
 *   `recordAudit` - the append-only audit entry point these services write to)
 * reconstruction_reason: net-new acceptance-phase file (REBUILD_INTEGRATION_ACCEPTANCE_V1,
 *   section 5 "跨 Lane 运行时接线") - no lane built a service layer during the overnight
 *   rebuild; D1-D6 are pure contracts/functions with nothing to call them, wire them to
 *   storage, or record an audit trail for their actions.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * Six services (of the nine named in this phase's spec - the other three,
 * TenancyRepository/AuthorizationService/AuditService, already exist as B1-B5's
 * in-memory-repository.ts/authorization.ts/audit.ts and are composed, not
 * reimplemented, by ApplicationCompositionRootV1 in ./application-composition-root.ts).
 *
 * Every mutation method below:
 *   1. Takes a server-resolved `actor: AuthorizationContext` first, and calls B2's
 *      `assertCanAccessClientOrganization` before touching any tenant-scoped data -
 *      never trusts a caller-supplied clientOrganizationId alone.
 *   2. Delegates the actual business transformation to D-lane's existing pure functions
 *      (`compileArticleDraft`, `evaluateQualityGate`, `buildPublishPackage`,
 *      `createChannelNeutralContentPackage`, `addTargetChannel`,
 *      `createPublicationReceipt`) wherever one exists - these services never
 *      reimplement business logic those functions already own.
 *   3. Persists the result via `InMemoryGeoBusinessRepository`.
 *   4. For the seven actions this phase's spec explicitly names (KnowledgePackage
 *      Created, Opportunity Created, Human Review Confirmed, Human Review Changes
 *      Requested, Article Approved, PublishPackage Created, Publication Receipt
 *      Recorded), calls `tenancyRepository.recordAudit(...)` - append-only, into B's
 *      real AuditEvent log, not a separate audit store.
 *
 * `now: Date` is an explicit parameter on every method (not `Date.now()` inside),
 * matching the determinism discipline D4-D6 already established for their pure
 * functions - these services are stateful (they call into a repository), but every
 * timestamp they produce is still caller-supplied, so a test can assert on exact
 * values rather than "some ISO string was produced".
 */
import { randomUUID } from "node:crypto";
import type { AuthorizationContext } from "../contracts/tenancy/entities.js";
import { assertCanAccessClientOrganization } from "../contracts/tenancy/authorization.js";
import type { InMemoryTenancyRepository } from "../contracts/tenancy/in-memory-repository.js";
import type { InMemoryGeoBusinessRepository } from "../contracts/geo-business/repository.js";
import {
  compileArticleDraft,
  evaluateQualityGate,
  buildPublishPackage,
  createChannelNeutralContentPackage,
  addTargetChannel,
  createPublicationReceipt,
  type ArticleApproval,
  type ArticleBrief,
  type ArticleDraft,
  type ChannelNeutralContentBlock,
  type ChannelNeutralContentPackage,
  type DistributionPlan,
  type GeoValidationGateLevel,
  type HumanReviewDecision,
  type IndustryProfile,
  type KeywordQuestionEntry,
  type KeywordQuestionMap,
  type KnowledgePackage,
  type Opportunity,
  type OpportunityFamily,
  type OpportunityValidation,
  type PlatformGate,
  type ProviderArticleContent,
  type PublicationReceipt,
  type PublishPackage,
  type QualityGate,
  type VerticalGate,
} from "../contracts/geo-business/entities.js";

/** Shared audit-recording helper so every service records to the same shape/convention. */
function audit(
  tenancyRepository: InMemoryTenancyRepository,
  actor: AuthorizationContext,
  clientOrganizationId: string,
  projectId: string,
  action: string,
  targetType: string,
  targetId: string,
  now: Date,
): void {
  tenancyRepository.recordAudit({
    organizationId: actor.organizationId,
    actorUserId: actor.actorUserId,
    actorOrganizationId: actor.organizationId,
    clientOrganizationId,
    projectId,
    action,
    targetType,
    targetId,
    now,
  });
}

// ---------------------------------------------------------------------------
// KnowledgeService — KnowledgePackage, IndustryProfile, KeywordQuestionMap.
// ---------------------------------------------------------------------------
export class KnowledgeService {
  constructor(
    private readonly geoBusinessRepository: InMemoryGeoBusinessRepository,
    private readonly tenancyRepository: InMemoryTenancyRepository,
  ) {}

  createKnowledgePackage(
    actor: AuthorizationContext,
    input: { clientOrganizationId: string; projectId: string; title: string; sourceDescription: string; version: number },
    now: Date,
  ): KnowledgePackage {
    assertCanAccessClientOrganization(actor, input.clientOrganizationId);
    const kp: KnowledgePackage = {
      id: randomUUID(),
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      version: input.version,
      title: input.title,
      sourceDescription: input.sourceDescription,
      status: "DRAFT",
      createdAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordKnowledgePackage(kp);
    // Spec section 5, action 1: "KnowledgePackage Created".
    audit(this.tenancyRepository, actor, input.clientOrganizationId, input.projectId, "knowledge_package.created", "KnowledgePackage", kp.id, now);
    return kp;
  }

  createIndustryProfile(
    actor: AuthorizationContext,
    input: {
      clientOrganizationId: string;
      projectId: string;
      verticalSlug: string;
      verticalLabel: string;
      validationGateLevel: GeoValidationGateLevel;
      ruleSetVersion: number;
    },
    now: Date,
  ): IndustryProfile {
    assertCanAccessClientOrganization(actor, input.clientOrganizationId);
    const profile: IndustryProfile = {
      id: randomUUID(),
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      verticalSlug: input.verticalSlug,
      verticalLabel: input.verticalLabel,
      validationGateLevel: input.validationGateLevel,
      ruleSetVersion: input.ruleSetVersion,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordIndustryProfile(profile);
    return profile;
  }

  createKeywordQuestionMap(
    actor: AuthorizationContext,
    input: { knowledgePackage: KnowledgePackage; industryProfileId: string; entries: KeywordQuestionEntry[] },
    now: Date,
  ): KeywordQuestionMap {
    assertCanAccessClientOrganization(actor, input.knowledgePackage.clientOrganizationId);
    const map: KeywordQuestionMap = {
      id: randomUUID(),
      clientOrganizationId: input.knowledgePackage.clientOrganizationId,
      projectId: input.knowledgePackage.projectId,
      knowledgePackageId: input.knowledgePackage.id,
      knowledgePackageVersion: input.knowledgePackage.version,
      industryProfileId: input.industryProfileId,
      entries: input.entries,
      createdAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordKeywordQuestionMap(map);
    return map;
  }
}

// ---------------------------------------------------------------------------
// OpportunityService — Opportunity, OpportunityValidation.
// ---------------------------------------------------------------------------
export class OpportunityService {
  constructor(
    private readonly geoBusinessRepository: InMemoryGeoBusinessRepository,
    private readonly tenancyRepository: InMemoryTenancyRepository,
  ) {}

  createOpportunity(
    actor: AuthorizationContext,
    input: { keywordQuestionMap: KeywordQuestionMap; keyword: string; knowledgePackage: KnowledgePackage },
    now: Date,
  ): Opportunity {
    assertCanAccessClientOrganization(actor, input.knowledgePackage.clientOrganizationId);
    const opportunity: Opportunity = {
      id: randomUUID(),
      clientOrganizationId: input.knowledgePackage.clientOrganizationId,
      projectId: input.knowledgePackage.projectId,
      keywordQuestionMapId: input.keywordQuestionMap.id,
      keyword: input.keyword,
      groundingKnowledgePackageId: input.knowledgePackage.id,
      groundingKnowledgePackageVersion: input.knowledgePackage.version,
      createdAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordOpportunity(opportunity);
    // Spec section 5, action 2: "Opportunity Created".
    audit(this.tenancyRepository, actor, opportunity.clientOrganizationId, opportunity.projectId, "opportunity.created", "Opportunity", opportunity.id, now);
    return opportunity;
  }

  validateOpportunity(
    actor: AuthorizationContext,
    opportunity: Opportunity,
    industryProfile: IndustryProfile,
    reasonNote: string,
    now: Date,
  ): OpportunityValidation {
    assertCanAccessClientOrganization(actor, opportunity.clientOrganizationId);
    const validation: OpportunityValidation = {
      id: randomUUID(),
      clientOrganizationId: opportunity.clientOrganizationId,
      projectId: opportunity.projectId,
      opportunityId: opportunity.id,
      status: "VALIDATED",
      industryProfileId: industryProfile.id,
      gateLevelApplied: industryProfile.validationGateLevel,
      reasonNote,
      validatedAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordOpportunityValidation(validation);
    return validation;
  }
}

// ---------------------------------------------------------------------------
// HumanReviewService — HumanReviewDecision. Per SYSTEM_INVARIANTS_V1.md "no
// silently-approved state": there is no "confirm by default" path - every
// method here requires a real reviewerId and produces exactly one of the
// three real HumanReviewDecision variants, never a bare boolean.
// ---------------------------------------------------------------------------
export class HumanReviewService {
  constructor(
    private readonly geoBusinessRepository: InMemoryGeoBusinessRepository,
    private readonly tenancyRepository: InMemoryTenancyRepository,
  ) {}

  confirm(
    actor: AuthorizationContext,
    validation: OpportunityValidation,
    reviewerId: string,
    now: Date,
  ): HumanReviewDecision {
    assertCanAccessClientOrganization(actor, validation.clientOrganizationId);
    const decision: HumanReviewDecision = {
      id: randomUUID(),
      clientOrganizationId: validation.clientOrganizationId,
      projectId: validation.projectId,
      opportunityId: validation.opportunityId,
      opportunityValidationId: validation.id,
      status: "APPROVED",
      reviewerId,
      decidedAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordHumanReviewDecision(decision);
    // Spec section 5, action 3: "Human Review Confirmed".
    audit(this.tenancyRepository, actor, decision.clientOrganizationId, decision.projectId, "human_review.confirmed", "HumanReviewDecision", decision.id, now);
    return decision;
  }

  requestChanges(
    actor: AuthorizationContext,
    validation: OpportunityValidation,
    reviewerId: string,
    requestedChangesNote: string,
    now: Date,
  ): HumanReviewDecision {
    assertCanAccessClientOrganization(actor, validation.clientOrganizationId);
    const decision: HumanReviewDecision = {
      id: randomUUID(),
      clientOrganizationId: validation.clientOrganizationId,
      projectId: validation.projectId,
      opportunityId: validation.opportunityId,
      opportunityValidationId: validation.id,
      status: "CHANGES_REQUESTED",
      reviewerId,
      decidedAt: now.toISOString(),
      requestedChangesNote,
    };
    this.geoBusinessRepository.recordHumanReviewDecision(decision);
    // Spec section 5, action 4: "Human Review Changes Requested".
    audit(this.tenancyRepository, actor, decision.clientOrganizationId, decision.projectId, "human_review.changes_requested", "HumanReviewDecision", decision.id, now);
    return decision;
  }

  reject(
    actor: AuthorizationContext,
    validation: OpportunityValidation,
    reviewerId: string,
    rejectionReasonNote: string,
    now: Date,
  ): HumanReviewDecision {
    assertCanAccessClientOrganization(actor, validation.clientOrganizationId);
    const decision: HumanReviewDecision = {
      id: randomUUID(),
      clientOrganizationId: validation.clientOrganizationId,
      projectId: validation.projectId,
      opportunityId: validation.opportunityId,
      opportunityValidationId: validation.id,
      status: "REJECTED",
      reviewerId,
      decidedAt: now.toISOString(),
      rejectionReasonNote,
    };
    this.geoBusinessRepository.recordHumanReviewDecision(decision);
    audit(this.tenancyRepository, actor, decision.clientOrganizationId, decision.projectId, "human_review.rejected", "HumanReviewDecision", decision.id, now);
    return decision;
  }
}

// ---------------------------------------------------------------------------
// ArticlePipelineService — OpportunityFamily, ArticleBrief,
// ProviderArticleContent, ArticleDraft (via compileArticleDraft), the three
// gates (QualityGate via evaluateQualityGate; PlatformGate/VerticalGate have
// no pure evaluator in entities.ts - D5 only defined the outcome shapes for
// those two, so this service provides the deterministic evaluators for them,
// following the exact same discipline: no imports beyond what's already
// here, no I/O, no Date.now()/Math.random(), caller-supplied identity/now),
// and ArticleApproval.
// ---------------------------------------------------------------------------
export class ArticlePipelineService {
  constructor(
    private readonly geoBusinessRepository: InMemoryGeoBusinessRepository,
    private readonly tenancyRepository: InMemoryTenancyRepository,
  ) {}

  createOpportunityFamily(
    actor: AuthorizationContext,
    members: OpportunityFamily["members"],
    clientOrganizationId: string,
    projectId: string,
    now: Date,
  ): OpportunityFamily {
    assertCanAccessClientOrganization(actor, clientOrganizationId);
    const family: OpportunityFamily = {
      id: randomUUID(),
      clientOrganizationId,
      projectId,
      members,
      createdAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordOpportunityFamily(family);
    return family;
  }

  createArticleBrief(
    actor: AuthorizationContext,
    family: OpportunityFamily,
    input: { workingTitle: string; outline: string[]; targetKeywords: [string, ...string[]]; riskLevel: "STANDARD" | "ESCALATED_FOR_HUMAN_REVIEW" },
    now: Date,
  ): ArticleBrief {
    assertCanAccessClientOrganization(actor, family.clientOrganizationId);
    const authorizingHumanReviewDecisionIds = family.members.map(
      (m) => m.authorizingHumanReviewDecisionId,
    ) as [string, ...string[]];
    const brief: ArticleBrief = {
      id: randomUUID(),
      clientOrganizationId: family.clientOrganizationId,
      projectId: family.projectId,
      opportunityFamilyId: family.id,
      planningContext: {
        schemaVersion: "ArticleBriefPlanningContextV1",
        opportunityFamilyId: family.id,
        authorizingHumanReviewDecisionIds,
        targetKeywords: input.targetKeywords,
        riskLevel: input.riskLevel,
      },
      workingTitle: input.workingTitle,
      outline: input.outline,
      createdAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordArticleBrief(brief);
    return brief;
  }

  recordProviderArticleContent(
    actor: AuthorizationContext,
    brief: ArticleBrief,
    providerResponseEnvelopeId: string,
    now: Date,
  ): ProviderArticleContent {
    assertCanAccessClientOrganization(actor, brief.clientOrganizationId);
    const content: ProviderArticleContent = {
      id: randomUUID(),
      clientOrganizationId: brief.clientOrganizationId,
      projectId: brief.projectId,
      articleBriefId: brief.id,
      providerResponseEnvelopeId,
      receivedAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordProviderArticleContent(content);
    return content;
  }

  compileDraft(
    actor: AuthorizationContext,
    brief: ArticleBrief,
    providerContents: ProviderArticleContent[],
    now: Date,
  ): ArticleDraft {
    assertCanAccessClientOrganization(actor, brief.clientOrganizationId);
    // Delegates entirely to D4's pure compileArticleDraft - this service adds no
    // business logic of its own here, only identity/persistence.
    const draft = compileArticleDraft(brief, providerContents, {
      id: randomUUID(),
      version: 1,
      compiledAt: now.toISOString(),
    });
    this.geoBusinessRepository.recordArticleDraft(draft);
    return draft;
  }

  evaluateQuality(actor: AuthorizationContext, draft: ArticleDraft, brief: ArticleBrief, now: Date): QualityGate {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);
    // Delegates entirely to D5's pure evaluateQualityGate.
    const gate = evaluateQualityGate(draft, brief, { id: randomUUID(), evaluatedAt: now.toISOString() });
    this.geoBusinessRepository.recordQualityGate(gate);
    return gate;
  }

  /**
   * D5 defined the PlatformGate outcome shape but, unlike QualityGate, did not
   * ship a pure evaluator for it (see this file's header). This deterministic
   * evaluator follows the exact same discipline evaluateQualityGate already
   * established: pure, no I/O, no clock/random access, caller-supplied
   * identity/now. Check: the draft must reference a real, non-empty set of
   * source provider contents (the same platform-wide "was this actually
   * compiled from something" floor every draft must clear, regardless of
   * industry vertical).
   */
  evaluatePlatformGate(
    actor: AuthorizationContext,
    draft: ArticleDraft,
    industryProfile: IndustryProfile,
    now: Date,
  ): PlatformGate {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);
    const failureReasons: string[] = [];
    if (draft.sourceProviderArticleContentIds.length === 0) {
      failureReasons.push("Draft has no source provider content references.");
    }
    if (draft.title.trim().length === 0) {
      failureReasons.push("Draft title is blank.");
    }
    const id = randomUUID();
    const evaluatedAt = now.toISOString();
    const gate: PlatformGate =
      failureReasons.length > 0
        ? {
            id,
            clientOrganizationId: draft.clientOrganizationId,
            projectId: draft.projectId,
            gateKind: "PLATFORM_GATE",
            articleDraftId: draft.id,
            industryProfileId: industryProfile.id,
            gateLevelApplied: industryProfile.validationGateLevel,
            status: "FAILED",
            failureReasons: failureReasons as [string, ...string[]],
            evaluatedAt,
          }
        : {
            id,
            clientOrganizationId: draft.clientOrganizationId,
            projectId: draft.projectId,
            gateKind: "PLATFORM_GATE",
            articleDraftId: draft.id,
            industryProfileId: industryProfile.id,
            gateLevelApplied: industryProfile.validationGateLevel,
            status: "PASSED",
            evaluatedAt,
          };
    this.geoBusinessRepository.recordPlatformGate(gate);
    return gate;
  }

  /** Same discipline as evaluatePlatformGate above, for the vertical-specific gate. */
  evaluateVerticalGate(
    actor: AuthorizationContext,
    draft: ArticleDraft,
    industryProfile: IndustryProfile,
    now: Date,
  ): VerticalGate {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);
    const failureReasons: string[] = [];
    if (draft.sections.length === 0) {
      failureReasons.push("Draft has no sections to evaluate against vertical rules.");
    }
    const id = randomUUID();
    const evaluatedAt = now.toISOString();
    const gate: VerticalGate =
      failureReasons.length > 0
        ? {
            id,
            clientOrganizationId: draft.clientOrganizationId,
            projectId: draft.projectId,
            gateKind: "VERTICAL_GATE",
            articleDraftId: draft.id,
            industryProfileId: industryProfile.id,
            gateLevelApplied: industryProfile.validationGateLevel,
            status: "FAILED",
            failureReasons: failureReasons as [string, ...string[]],
            evaluatedAt,
          }
        : {
            id,
            clientOrganizationId: draft.clientOrganizationId,
            projectId: draft.projectId,
            gateKind: "VERTICAL_GATE",
            articleDraftId: draft.id,
            industryProfileId: industryProfile.id,
            gateLevelApplied: industryProfile.validationGateLevel,
            status: "PASSED",
            evaluatedAt,
          };
    this.geoBusinessRepository.recordVerticalGate(gate);
    return gate;
  }

  /**
   * Constructs an ArticleApproval. Only callable with three real PASSED gate
   * results - per D5's structural gating (each gate field is pinned to the
   * literal "PASSED"), a FAILED or missing gate does not type-check here,
   * not merely fail a runtime check.
   */
  approveArticle(
    actor: AuthorizationContext,
    draft: ArticleDraft,
    approverId: string,
    qualityGate: Extract<QualityGate, { status: "PASSED" }>,
    platformGate: Extract<PlatformGate, { status: "PASSED" }>,
    verticalGate: Extract<VerticalGate, { status: "PASSED" }>,
    now: Date,
  ): ArticleApproval {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);
    const approval: ArticleApproval = {
      id: randomUUID(),
      clientOrganizationId: draft.clientOrganizationId,
      projectId: draft.projectId,
      articleDraftId: draft.id,
      approverId,
      approvedAt: now.toISOString(),
      qualityGateId: qualityGate.id,
      qualityGateStatus: "PASSED",
      platformGateId: platformGate.id,
      platformGateStatus: "PASSED",
      verticalGateId: verticalGate.id,
      verticalGateStatus: "PASSED",
    };
    this.geoBusinessRepository.recordArticleApproval(approval);
    // Spec section 5, action 5: "Article Approved".
    audit(this.tenancyRepository, actor, approval.clientOrganizationId, approval.projectId, "article.approved", "ArticleApproval", approval.id, now);
    return approval;
  }
}

// ---------------------------------------------------------------------------
// PublicationPackageService — PublishPackage, ChannelNeutralContentPackage,
// DistributionPlan, PublicationReceipt.
// ---------------------------------------------------------------------------
export class PublicationPackageService {
  constructor(
    private readonly geoBusinessRepository: InMemoryGeoBusinessRepository,
    private readonly tenancyRepository: InMemoryTenancyRepository,
  ) {}

  createPublishPackage(actor: AuthorizationContext, approval: ArticleApproval, draft: ArticleDraft, now: Date): PublishPackage {
    assertCanAccessClientOrganization(actor, approval.clientOrganizationId);
    // Delegates entirely to D6's pure buildPublishPackage.
    const pkg = buildPublishPackage(approval, draft, { id: randomUUID(), builtAt: now.toISOString() });
    this.geoBusinessRepository.recordPublishPackage(pkg);
    // Spec section 5, action 6: "PublishPackage Created".
    audit(this.tenancyRepository, actor, pkg.clientOrganizationId, pkg.projectId, "publish_package.created", "PublishPackage", pkg.id, now);
    return pkg;
  }

  createChannelNeutralPackage(
    actor: AuthorizationContext,
    publishPackage: PublishPackage,
    blocks: ChannelNeutralContentBlock[],
    now: Date,
  ): ChannelNeutralContentPackage {
    assertCanAccessClientOrganization(actor, publishPackage.clientOrganizationId);
    // Delegates entirely to D6's pure createChannelNeutralContentPackage -
    // always starts with 0 target channels, per that function's own guarantee.
    const pkg = createChannelNeutralContentPackage(publishPackage, blocks, { id: randomUUID(), createdAt: now.toISOString() });
    this.geoBusinessRepository.recordChannelNeutralContentPackage(pkg);
    return pkg;
  }

  /**
   * Creates a DistributionPlan. Per SYSTEM_INVARIANTS_V1.md "Publication" and
   * D6's design, there is no path to a "ready" plan with zero channels: this
   * method's `channelIds` parameter is typed as the same non-empty tuple as
   * `DistributionPlan.channelIds` itself, so calling this with an empty array
   * does not type-check - the human selection this represents must have
   * already happened before this method can even be called.
   */
  createDistributionPlan(
    actor: AuthorizationContext,
    channelNeutralPackage: ChannelNeutralContentPackage,
    channelIds: [string, ...string[]],
    selectedByActorId: string,
    now: Date,
  ): DistributionPlan {
    assertCanAccessClientOrganization(actor, channelNeutralPackage.clientOrganizationId);
    const plan: DistributionPlan = {
      id: randomUUID(),
      clientOrganizationId: channelNeutralPackage.clientOrganizationId,
      projectId: channelNeutralPackage.projectId,
      channelNeutralContentPackageId: channelNeutralPackage.id,
      channelIds,
      selectedByActorId,
      selectedAt: now.toISOString(),
    };
    this.geoBusinessRepository.recordDistributionPlan(plan);
    return plan;
  }

  recordPublicationReceipt(
    actor: AuthorizationContext,
    plan: DistributionPlan,
    channelId: string,
    publishedByActorId: string,
    now: Date,
  ): PublicationReceipt {
    assertCanAccessClientOrganization(actor, plan.clientOrganizationId);
    // Delegates entirely to D6's pure createPublicationReceipt, which itself
    // throws on any automatic/system actor id - "no automatic publication
    // under any circumstance" is enforced there, not reimplemented here.
    const receipt = createPublicationReceipt(plan, channelId, publishedByActorId, {
      id: randomUUID(),
      publishedAt: now.toISOString(),
    });
    this.geoBusinessRepository.recordPublicationReceipt(receipt);
    // Spec section 5, action 7: "Publication Receipt Recorded".
    audit(this.tenancyRepository, actor, receipt.clientOrganizationId, receipt.projectId, "publication_receipt.recorded", "PublicationReceipt", receipt.id, now);
    return receipt;
  }
}

export { addTargetChannel };
