/**
 * Lane-local command-result DTOs for the GEO business chain (Agent C — batch 2).
 *
 * The frozen cross-lane contract (src/runtime/api-contracts/index.ts, owned by Agent A) carries
 * only presentation READ view-models; it has no view-model for the *write* results these commands
 * produce, and this lane may not modify that frozen file. These DTOs are therefore declared here,
 * in the command lane's own directory, as the canonical envelopes for the geo-chain command
 * responses.
 *
 * Client-surface safety (SYSTEM_INVARIANTS_V1.md): these are view-models — stable ids, tenant
 * refs, statuses, and human-facing fields only. Every field is derived from a persisted artifact;
 * none echoes back a caller-supplied organization id (the server-resolved tenant is authoritative).
 * They are plain JSON so batch-1's idempotency ledger can replay them verbatim.
 */
import type {
  ArticleBriefPlanningContextV1,
  GeoValidationGateLevel,
  HumanReviewDecisionStatus,
  OpportunityValidationStatus,
} from "../../contracts/geo-business/entities.js";

/** A newly-created (geo) IndustryProfile — the per-project vertical classification context. */
export interface IndustryProfileViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly verticalSlug: string;
  readonly verticalLabel: string;
  readonly validationGateLevel: GeoValidationGateLevel;
  readonly ruleSetVersion: number;
  readonly createdAt: string;
}

/** A newly-created knowledge package (the canonical enterprise-knowledge record, migration 0002). */
export interface KnowledgePackageCommandViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: "DRAFT" | "IN_REVIEW" | "CONFIRMED";
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

/** A newly-created KeywordQuestionMap (keyword <-> real-user-question mapping). */
export interface KeywordQuestionMapViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly knowledgePackageId: string;
  readonly knowledgePackageVersion: number;
  readonly industryProfileId: string;
  readonly keywords: readonly string[];
  readonly createdAt: string;
}

/** A newly-derived Opportunity plus its automated validation outcome. */
export interface OpportunityCommandViewV1 {
  readonly opportunity: {
    readonly id: string;
    readonly clientOrganizationId: string;
    readonly projectId: string;
    readonly keywordQuestionMapId: string;
    readonly keyword: string;
    readonly groundingKnowledgePackageId: string;
    readonly groundingKnowledgePackageVersion: number;
    readonly createdAt: string;
  };
  readonly validation: {
    readonly id: string;
    readonly opportunityId: string;
    readonly status: OpportunityValidationStatus;
    readonly industryProfileId: string;
    readonly gateLevelApplied: GeoValidationGateLevel;
    readonly validatedAt: string;
  };
}

/** A recorded human-review decision (never auto-approved — always a real reviewer + decision). */
export interface HumanReviewDecisionViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly opportunityId: string;
  readonly opportunityValidationId: string;
  readonly status: HumanReviewDecisionStatus;
  readonly reviewerId: string;
  readonly decidedAt: string;
}

/** A newly-created OpportunityFamily. */
export interface OpportunityFamilyViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly memberOpportunityIds: readonly string[];
  readonly createdAt: string;
}

/** A newly-created ArticleBrief. */
export interface ArticleBriefViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly opportunityFamilyId: string;
  readonly workingTitle: string;
  readonly outline: readonly string[];
  readonly riskLevel: ArticleBriefPlanningContextV1["riskLevel"];
  readonly createdAt: string;
}

/** A compiled ArticleDraft (deterministic, offline — Provider Calls = 0). */
export interface ArticleDraftCommandViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly articleBriefId: string;
  readonly version: number;
  readonly title: string;
  readonly status: "DRAFT";
  readonly sectionCount: number;
  readonly sourceProviderArticleContentIds: readonly string[];
  readonly compiledAt: string;
}

/** A final ArticleApproval (never auto-approved — real approver + three PASSED gates). */
export interface ArticleApprovalViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly articleDraftId: string;
  readonly approverId: string;
  readonly approvedAt: string;
  readonly qualityGateId: string;
  readonly platformGateId: string;
  readonly verticalGateId: string;
}

/** A publish package plus its channel-neutral content package (0 selected channels by default). */
export interface PublishPackageCommandViewV1 {
  readonly publishPackage: {
    readonly id: string;
    readonly clientOrganizationId: string;
    readonly projectId: string;
    readonly articleApprovalId: string;
    readonly articleDraftId: string;
    readonly title: string;
    readonly builtAt: string;
  };
  readonly channelNeutralContentPackage: {
    readonly id: string;
    readonly publishPackageId: string;
    /** Zero by construction — no default channel is ever auto-selected. */
    readonly selectedChannelCount: number;
    readonly blockCount: number;
    readonly createdAt: string;
  };
}

/** A distribution plan — the explicit, human-chosen set of channels. */
export interface DistributionPlanViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly channelNeutralContentPackageId: string;
  readonly channelIds: readonly string[];
  readonly selectedByActorId: string;
  readonly selectedAt: string;
}

/** A publication receipt — records a real (never automatic) human/service actor published. */
export interface PublicationReceiptViewV1 {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly distributionPlanId: string;
  readonly channelId: string;
  readonly publishedByActorId: string;
  readonly publishedAt: string;
}
