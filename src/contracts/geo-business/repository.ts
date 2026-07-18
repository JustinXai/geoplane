/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/tenancy/in-memory-repository.ts (checkpoint B5 -
 *   same Map-backed, no-database, no-real-async-I/O design discipline applied here to
 *   the GEO business chain instead of tenancy)
 * reconstruction_reason: net-new acceptance-phase file (REBUILD_INTEGRATION_ACCEPTANCE_V1,
 *   section 5 "跨 Lane 运行时接线") - no lane during the overnight rebuild built a
 *   repository for the GEO chain; D1-D6 are pure types + pure transformation functions
 *   with no storage layer of their own. This file is that missing storage layer.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * Plain in-memory, Map-backed storage for every entity in
 * src/contracts/geo-business/entities.ts. No database, no real async I/O - exists so
 * the composition root's services (src/composition/application-composition-root.ts)
 * have somewhere real to persist records and query them back, proving the chain
 * actually composes end-to-end. A future checkpoint implementing a real Postgres-backed
 * repository is expected to satisfy the same read/write contract this class exposes.
 */
import type {
  ArticleApproval,
  ArticleBrief,
  ArticleDraft,
  ChannelNeutralContentPackage,
  DistributionPlan,
  HumanReviewDecision,
  IndustryProfile,
  KeywordQuestionMap,
  KnowledgePackage,
  Opportunity,
  OpportunityFamily,
  OpportunityValidation,
  PlatformGate,
  ProviderArticleContent,
  PublicationReceipt,
  PublishPackage,
  QualityGate,
  VerticalGate,
} from "./entities.js";

/** Scopes a list query to one tenant (client organization + project). */
export interface TenantScope {
  clientOrganizationId: string;
  projectId: string;
}

function byTenant<T extends { clientOrganizationId: string; projectId: string }>(
  items: readonly T[],
  scope: TenantScope,
): T[] {
  return items.filter(
    (item) => item.clientOrganizationId === scope.clientOrganizationId && item.projectId === scope.projectId,
  );
}

/**
 * In-memory, Map-backed repository for the entire GEO business chain
 * (KnowledgePackage through PublicationReceipt). One Map per entity type,
 * keyed by id; `list*(scope)` methods filter by tenant. Every `record*`
 * method is a pure "store this already-constructed, already-validated
 * value" call - this repository does not itself run any business-rule
 * validation (that lives in entities.ts's pure functions, e.g.
 * `compileArticleDraft`, `evaluateQualityGate`, `buildPublishPackage`) or
 * in the composition root's services, which call those functions before
 * ever reaching this class.
 */
export class InMemoryGeoBusinessRepository {
  private readonly knowledgePackagesById = new Map<string, KnowledgePackage>();
  private readonly industryProfilesById = new Map<string, IndustryProfile>();
  private readonly keywordQuestionMapsById = new Map<string, KeywordQuestionMap>();
  private readonly opportunitiesById = new Map<string, Opportunity>();
  private readonly opportunityValidationsById = new Map<string, OpportunityValidation>();
  private readonly humanReviewDecisionsById = new Map<string, HumanReviewDecision>();
  private readonly opportunityFamiliesById = new Map<string, OpportunityFamily>();
  private readonly articleBriefsById = new Map<string, ArticleBrief>();
  private readonly providerArticleContentsById = new Map<string, ProviderArticleContent>();
  private readonly articleDraftsById = new Map<string, ArticleDraft>();
  private readonly qualityGatesById = new Map<string, QualityGate>();
  private readonly platformGatesById = new Map<string, PlatformGate>();
  private readonly verticalGatesById = new Map<string, VerticalGate>();
  private readonly articleApprovalsById = new Map<string, ArticleApproval>();
  private readonly publishPackagesById = new Map<string, PublishPackage>();
  private readonly channelNeutralContentPackagesById = new Map<string, ChannelNeutralContentPackage>();
  private readonly distributionPlansById = new Map<string, DistributionPlan>();
  private readonly publicationReceiptsById = new Map<string, PublicationReceipt>();

  recordKnowledgePackage(kp: KnowledgePackage): KnowledgePackage {
    this.knowledgePackagesById.set(kp.id, kp);
    return kp;
  }
  getKnowledgePackage(id: string): KnowledgePackage | undefined {
    return this.knowledgePackagesById.get(id);
  }
  listKnowledgePackages(scope: TenantScope): KnowledgePackage[] {
    return byTenant([...this.knowledgePackagesById.values()], scope);
  }

  recordIndustryProfile(profile: IndustryProfile): IndustryProfile {
    this.industryProfilesById.set(profile.id, profile);
    return profile;
  }
  getIndustryProfile(id: string): IndustryProfile | undefined {
    return this.industryProfilesById.get(id);
  }

  recordKeywordQuestionMap(map: KeywordQuestionMap): KeywordQuestionMap {
    this.keywordQuestionMapsById.set(map.id, map);
    return map;
  }
  getKeywordQuestionMap(id: string): KeywordQuestionMap | undefined {
    return this.keywordQuestionMapsById.get(id);
  }
  listKeywordQuestionMaps(scope: TenantScope): KeywordQuestionMap[] {
    return byTenant([...this.keywordQuestionMapsById.values()], scope);
  }

  recordOpportunity(opportunity: Opportunity): Opportunity {
    this.opportunitiesById.set(opportunity.id, opportunity);
    return opportunity;
  }
  getOpportunity(id: string): Opportunity | undefined {
    return this.opportunitiesById.get(id);
  }
  listOpportunities(scope: TenantScope): Opportunity[] {
    return byTenant([...this.opportunitiesById.values()], scope);
  }

  recordOpportunityValidation(validation: OpportunityValidation): OpportunityValidation {
    this.opportunityValidationsById.set(validation.id, validation);
    return validation;
  }
  getOpportunityValidation(id: string): OpportunityValidation | undefined {
    return this.opportunityValidationsById.get(id);
  }

  recordHumanReviewDecision(decision: HumanReviewDecision): HumanReviewDecision {
    this.humanReviewDecisionsById.set(decision.id, decision);
    return decision;
  }
  getHumanReviewDecision(id: string): HumanReviewDecision | undefined {
    return this.humanReviewDecisionsById.get(id);
  }
  listHumanReviewDecisions(scope: TenantScope): HumanReviewDecision[] {
    return byTenant([...this.humanReviewDecisionsById.values()], scope);
  }

  recordOpportunityFamily(family: OpportunityFamily): OpportunityFamily {
    this.opportunityFamiliesById.set(family.id, family);
    return family;
  }
  getOpportunityFamily(id: string): OpportunityFamily | undefined {
    return this.opportunityFamiliesById.get(id);
  }

  recordArticleBrief(brief: ArticleBrief): ArticleBrief {
    this.articleBriefsById.set(brief.id, brief);
    return brief;
  }
  getArticleBrief(id: string): ArticleBrief | undefined {
    return this.articleBriefsById.get(id);
  }

  recordProviderArticleContent(content: ProviderArticleContent): ProviderArticleContent {
    this.providerArticleContentsById.set(content.id, content);
    return content;
  }
  listProviderArticleContent(articleBriefId: string): ProviderArticleContent[] {
    return [...this.providerArticleContentsById.values()].filter((c) => c.articleBriefId === articleBriefId);
  }

  recordArticleDraft(draft: ArticleDraft): ArticleDraft {
    this.articleDraftsById.set(draft.id, draft);
    return draft;
  }
  getArticleDraft(id: string): ArticleDraft | undefined {
    return this.articleDraftsById.get(id);
  }

  recordQualityGate(gate: QualityGate): QualityGate {
    this.qualityGatesById.set(gate.id, gate);
    return gate;
  }
  getQualityGate(id: string): QualityGate | undefined {
    return this.qualityGatesById.get(id);
  }

  recordPlatformGate(gate: PlatformGate): PlatformGate {
    this.platformGatesById.set(gate.id, gate);
    return gate;
  }
  getPlatformGate(id: string): PlatformGate | undefined {
    return this.platformGatesById.get(id);
  }

  recordVerticalGate(gate: VerticalGate): VerticalGate {
    this.verticalGatesById.set(gate.id, gate);
    return gate;
  }
  getVerticalGate(id: string): VerticalGate | undefined {
    return this.verticalGatesById.get(id);
  }

  recordArticleApproval(approval: ArticleApproval): ArticleApproval {
    this.articleApprovalsById.set(approval.id, approval);
    return approval;
  }
  getArticleApproval(id: string): ArticleApproval | undefined {
    return this.articleApprovalsById.get(id);
  }
  listArticleApprovals(scope: TenantScope): ArticleApproval[] {
    return byTenant([...this.articleApprovalsById.values()], scope);
  }

  recordPublishPackage(pkg: PublishPackage): PublishPackage {
    this.publishPackagesById.set(pkg.id, pkg);
    return pkg;
  }
  getPublishPackage(id: string): PublishPackage | undefined {
    return this.publishPackagesById.get(id);
  }
  listPublishPackages(scope: TenantScope): PublishPackage[] {
    return byTenant([...this.publishPackagesById.values()], scope);
  }

  recordChannelNeutralContentPackage(pkg: ChannelNeutralContentPackage): ChannelNeutralContentPackage {
    this.channelNeutralContentPackagesById.set(pkg.id, pkg);
    return pkg;
  }
  getChannelNeutralContentPackage(id: string): ChannelNeutralContentPackage | undefined {
    return this.channelNeutralContentPackagesById.get(id);
  }
  /** The ChannelNeutralContentPackage (if any) built from a given PublishPackage - at most one is expected in this offline model. */
  getChannelNeutralContentPackageForPublishPackage(publishPackageId: string): ChannelNeutralContentPackage | undefined {
    return [...this.channelNeutralContentPackagesById.values()].find((p) => p.publishPackageId === publishPackageId);
  }

  recordDistributionPlan(plan: DistributionPlan): DistributionPlan {
    this.distributionPlansById.set(plan.id, plan);
    return plan;
  }
  getDistributionPlan(id: string): DistributionPlan | undefined {
    return this.distributionPlansById.get(id);
  }
  /** The DistributionPlan (if any) for a given ChannelNeutralContentPackage - at most one is expected in this offline model. */
  getDistributionPlanForPackage(channelNeutralContentPackageId: string): DistributionPlan | undefined {
    return [...this.distributionPlansById.values()].find(
      (p) => p.channelNeutralContentPackageId === channelNeutralContentPackageId,
    );
  }

  recordPublicationReceipt(receipt: PublicationReceipt): PublicationReceipt {
    this.publicationReceiptsById.set(receipt.id, receipt);
    return receipt;
  }
  listPublicationReceiptsForPlan(distributionPlanId: string): PublicationReceipt[] {
    return [...this.publicationReceiptsById.values()].filter((r) => r.distributionPlanId === distributionPlanId);
  }
  listPublicationReceipts(scope: TenantScope): PublicationReceipt[] {
    return byTenant([...this.publicationReceiptsById.values()], scope);
  }

  /**
   * Every distinct (clientOrganizationId, projectId) scope this repository has ever
   * recorded a KnowledgePackage for - every real business flow starts with a
   * KnowledgePackage (D1, chain item 1), so this is a reliable enumeration of "every
   * tenant scope this repository knows about" for read-model aggregation, without
   * needing a separate scope-registry.
   */
  listKnownTenantScopes(): TenantScope[] {
    const seen = new Map<string, TenantScope>();
    for (const kp of this.knowledgePackagesById.values()) {
      const key = `${kp.clientOrganizationId}::${kp.projectId}`;
      if (!seen.has(key)) {
        seen.set(key, { clientOrganizationId: kp.clientOrganizationId, projectId: kp.projectId });
      }
    }
    return [...seen.values()];
  }
}
