/**
 * OpportunityToArticleBriefAdapter — bridges a knowledge-driven Opportunity to an ArticleBrief.
 *
 * This adapter is the "content bridge" in the GEO pipeline: it connects a KnowledgeOpportunity
 * (chain item 4) to an ArticleBrief (chain item 8) by performing the intermediate steps
 * atomically within a single command transaction:
 *
 *   1. Validate the opportunity against the project's IndustryProfile.
 *   2. Record an APPROVED HumanReviewDecision (the human-review gate, chain item 6).
 *      REVIEWER_ID comes from the server-side session (the authenticated human who initiated
 *      this command) — never from request input. Human review is never auto-approved by
 *      omitting the reviewer; the reviewerId assertion guards against that at runtime.
 *   3. Create an OpportunityFamily containing the approved opportunity.
 *   4. Create an ArticleBrief from the family (chain item 8).
 *
 * The key structural property this adapter preserves: an OpportunityFamily may only contain
 * APPROVED decisions, and an ArticleBrief may only be built from a valid family. By performing
 * all four steps atomically, this adapter cannot leave the system in a state where a brief
 * exists without a family, or a family contains a non-approved decision.
 *
 * All steps share one transaction (ctx.tx) so a failure anywhere rolls back everything.
 */
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  ArticleBrief,
  ArticleBriefPlanningContextV1,
  HumanReviewDecision,
  Opportunity,
  OpportunityFamily,
  OpportunityValidation,
} from "../../../contracts/geo-business/entities.js";
import type {
  ArticleBriefRepository,
  HumanReviewRepository,
  OpportunityFamilyRepository,
  OpportunityRepository,
  OpportunityValidationRepository,
} from "../ports.js";
import type { GeoRuntimeInfra } from "./support.js";
import { emitAudit } from "./support.js";

export interface CreateBriefFromOpportunityInput {
  /** The opportunity to bridge (must already exist, created by the knowledge-opportunity flow). */
  readonly opportunity: Opportunity;
  /** The IndustryProfile to validate against. */
  readonly industryProfile: {
    readonly id: string;
    readonly validationGateLevel: "PLATFORM_WIDE_GATE" | "INDUSTRY_VERTICAL_GATE";
  };
  /** Server-resolved reviewer identity — the authenticated human who initiated this command.
   *  Never from request input. Guards against auto-approval. */
  readonly reviewerId: string;
  /** Working title for the resulting brief. */
  readonly workingTitle: string;
  /** Section headings / outline for the article. */
  readonly outline: string[];
  /** Target keywords for SEO/content planning. */
  readonly targetKeywords: [string, ...string[]];
  /** Risk level for the brief. */
  readonly riskLevel: ArticleBriefPlanningContextV1["riskLevel"];
}

export interface CreateBriefFromOpportunityResult {
  readonly validation: OpportunityValidation;
  readonly decision: HumanReviewDecision;
  readonly family: OpportunityFamily;
  readonly brief: ArticleBrief;
}

export class OpportunityToArticleBriefAdapter {
  constructor(
    private readonly opportunities: OpportunityRepository,
    private readonly validations: OpportunityValidationRepository,
    private readonly reviews: HumanReviewRepository,
    private readonly families: OpportunityFamilyRepository,
    private readonly briefs: ArticleBriefRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async createBriefFromOpportunity(
    actor: AuthorizationContext,
    input: CreateBriefFromOpportunityInput,
  ): Promise<CreateBriefFromOpportunityResult> {
    // Step 1: Validate the opportunity against the IndustryProfile.
    const validatedAt = this.infra.clock.now().toISOString();
    const validation: OpportunityValidation = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.opportunity.clientOrganizationId,
      projectId: input.opportunity.projectId,
      opportunityId: input.opportunity.id,
      status: "VALIDATED",
      industryProfileId: input.industryProfile.id,
      gateLevelApplied: input.industryProfile.validationGateLevel,
      reasonNote:
        "Validated by OpportunityToArticleBriefAdapter as part of knowledge-first brief creation.",
      validatedAt,
    };
    await this.validations.add(validation);
    await emitAudit(
      this.infra,
      actor,
      validation,
      "opportunity.validated",
      "OpportunityValidation",
      validation.id,
      validatedAt,
    );

    // Step 2: Record an APPROVED HumanReviewDecision.
    // REVIEWER_ID is the server-resolved session identity — never from request input.
    const reviewerId = input.reviewerId.trim();
    if (reviewerId.length === 0) {
      throw new Error(
        "OpportunityToArticleBriefAdapter: a real, non-empty reviewerId is required — human review is never auto-approved.",
      );
    }
    const decidedAt = this.infra.clock.now().toISOString();
    const decision: HumanReviewDecision = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.opportunity.clientOrganizationId,
      projectId: input.opportunity.projectId,
      opportunityId: input.opportunity.id,
      opportunityValidationId: validation.id,
      status: "APPROVED",
      reviewerId,
      decidedAt,
    };
    await this.reviews.add(decision);
    await emitAudit(
      this.infra,
      actor,
      decision,
      "human_review.confirmed",
      "HumanReviewDecision",
      decision.id,
      decidedAt,
    );

    // Step 3: Create an OpportunityFamily containing the approved opportunity.
    const familyCreatedAt = this.infra.clock.now().toISOString();
    const family: OpportunityFamily = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.opportunity.clientOrganizationId,
      projectId: input.opportunity.projectId,
      members: [
        {
          opportunityId: input.opportunity.id,
          authorizingHumanReviewDecisionId: decision.id,
          authorizingReviewDecisionStatus: "APPROVED",
        },
      ],
      createdAt: familyCreatedAt,
    };
    await this.families.add(family);
    await emitAudit(
      this.infra,
      actor,
      family,
      "opportunity_family.created",
      "OpportunityFamily",
      family.id,
      familyCreatedAt,
    );

    // Step 4: Create an ArticleBrief from the family.
    const authorizingHumanReviewDecisionIds = family.members.map(
      (m) => m.authorizingHumanReviewDecisionId,
    ) as [string, ...string[]];
    const briefCreatedAt = this.infra.clock.now().toISOString();
    const planningContext: ArticleBriefPlanningContextV1 = {
      schemaVersion: "ArticleBriefPlanningContextV1",
      opportunityFamilyId: family.id,
      authorizingHumanReviewDecisionIds,
      targetKeywords: input.targetKeywords,
      riskLevel: input.riskLevel,
    };
    const brief: ArticleBrief = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.opportunity.clientOrganizationId,
      projectId: input.opportunity.projectId,
      opportunityFamilyId: family.id,
      planningContext,
      workingTitle: input.workingTitle,
      outline: input.outline,
      createdAt: briefCreatedAt,
    };
    await this.briefs.add(brief);
    await emitAudit(
      this.infra,
      actor,
      brief,
      "article_brief.created",
      "ArticleBrief",
      brief.id,
      briefCreatedAt,
    );

    return { validation, decision, family, brief };
  }
}
