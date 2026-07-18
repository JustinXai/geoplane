/**
 * GEO_RUNTIME_SERVICE_PORTS_V1 — consumer-defined ports.
 *
 * These interfaces are defined by the CONSUMER (the GEO runtime application
 * services in ./services/*.ts), not by any persistence implementation. They
 * are the only storage/audit/clock/id surface those services depend on, so
 * every service can be unit-tested with plain in-memory fakes and zero
 * database (see tests/runtime/geo/*.test.ts).
 *
 * Design rules baked into these ports:
 *
 *  - APPEND-ONLY. Every repository exposes `add` (insert a brand-new record)
 *    and read methods only. There is deliberately NO `update`/`overwrite`
 *    method anywhere — "historical artifacts are never mutated" is a
 *    structural property of this interface set, not a runtime convention. A
 *    revised artifact is a new record with a new id (and, where the entity is
 *    versioned, an incremented `version`), never a mutation of an existing
 *    one. A conforming fake MUST reject a duplicate id from `add`.
 *
 *  - TENANT-SCOPED. Every list/read that could span tenants is filtered by a
 *    `TenantScope` (clientOrganizationId + projectId). Services additionally
 *    gate every action on the frozen `assertCanAccessClientOrganization`
 *    tenant-isolation check before touching a repository.
 *
 *  - AUDITABLE. Every state-changing service action emits exactly one
 *    `AuditIntent` through `AuditPort`. The intent is tenant + project scoped
 *    and carries the resolved actor identity.
 *
 *  - DETERMINISTIC. Time and identity are injected via `Clock` / `IdFactory`
 *    rather than read from `Date.now()` / `randomUUID()` inside a service, so
 *    a test can drive a fully deterministic run (same inputs -> same output).
 *
 * No provider/network port exists in this module at all: the article pipeline
 * consumes already-produced `ProviderArticleContent` records as data. There is
 * no code path here through which a service could call a real provider —
 * "Provider Calls = 0" is enforced by the absence of such a port, not by a
 * runtime counter.
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
} from "../../contracts/geo-business/entities.js";

// ---------------------------------------------------------------------------
// Cross-cutting infrastructure ports
// ---------------------------------------------------------------------------

/** Scopes a query to one tenant (client organization + project). */
export interface TenantScope {
  readonly clientOrganizationId: string;
  readonly projectId: string;
}

/**
 * Injected wall-clock. Services never call `Date.now()` directly; a test
 * supplies a fixed clock so timestamps are deterministic and assertable.
 */
export interface Clock {
  now(): Date;
}

/**
 * Injected identity source. Services never call `randomUUID()` directly; a
 * test supplies a deterministic factory so two runs over the same inputs
 * produce deep-equal records.
 */
export interface IdFactory {
  next(): string;
}

/**
 * One append-only audit intent produced by a state-changing service action.
 * Tenant + project scoped and carrying the resolved actor identity. Mirrors
 * the field set the frozen tenancy AuditEvent hashes over, but is a
 * consumer-defined shape so these services never depend on a concrete audit
 * store.
 */
export interface AuditIntent {
  readonly actorUserId: string;
  readonly actorOrganizationId: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  /** Dotted action name, e.g. "opportunity.created". */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly occurredAt: string;
}

/** Sink for audit intents. The only side effect a service has beyond persistence. */
export interface AuditPort {
  record(intent: AuditIntent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Repository ports (append-only). One per aggregate the services touch.
// ---------------------------------------------------------------------------

export interface KnowledgePackageRepository {
  /** @throws if a record with `kp.id` already exists (append-only). */
  add(kp: KnowledgePackage): Promise<KnowledgePackage>;
  getById(id: string): Promise<KnowledgePackage | undefined>;
  listByScope(scope: TenantScope): Promise<KnowledgePackage[]>;
}

export interface IndustryProfileRepository {
  add(profile: IndustryProfile): Promise<IndustryProfile>;
  getById(id: string): Promise<IndustryProfile | undefined>;
}

export interface KeywordQuestionMapRepository {
  add(map: KeywordQuestionMap): Promise<KeywordQuestionMap>;
  getById(id: string): Promise<KeywordQuestionMap | undefined>;
  listByScope(scope: TenantScope): Promise<KeywordQuestionMap[]>;
}

export interface OpportunityRepository {
  add(opportunity: Opportunity): Promise<Opportunity>;
  getById(id: string): Promise<Opportunity | undefined>;
  listByScope(scope: TenantScope): Promise<Opportunity[]>;
}

export interface OpportunityValidationRepository {
  add(validation: OpportunityValidation): Promise<OpportunityValidation>;
  getById(id: string): Promise<OpportunityValidation | undefined>;
}

export interface HumanReviewRepository {
  add(decision: HumanReviewDecision): Promise<HumanReviewDecision>;
  getById(id: string): Promise<HumanReviewDecision | undefined>;
  listByScope(scope: TenantScope): Promise<HumanReviewDecision[]>;
}

export interface OpportunityFamilyRepository {
  add(family: OpportunityFamily): Promise<OpportunityFamily>;
  getById(id: string): Promise<OpportunityFamily | undefined>;
}

export interface ArticleBriefRepository {
  add(brief: ArticleBrief): Promise<ArticleBrief>;
  getById(id: string): Promise<ArticleBrief | undefined>;
}

export interface ProviderArticleContentRepository {
  add(content: ProviderArticleContent): Promise<ProviderArticleContent>;
  listByArticleBrief(articleBriefId: string): Promise<ProviderArticleContent[]>;
}

export interface ArticleDraftRepository {
  add(draft: ArticleDraft): Promise<ArticleDraft>;
  getById(id: string): Promise<ArticleDraft | undefined>;
  /** Every draft compiled from a given brief, for version derivation. */
  listByArticleBrief(articleBriefId: string): Promise<ArticleDraft[]>;
}

export interface QualityGateRepository {
  add(gate: QualityGate): Promise<QualityGate>;
  getById(id: string): Promise<QualityGate | undefined>;
}

export interface PlatformGateRepository {
  add(gate: PlatformGate): Promise<PlatformGate>;
  getById(id: string): Promise<PlatformGate | undefined>;
}

export interface VerticalGateRepository {
  add(gate: VerticalGate): Promise<VerticalGate>;
  getById(id: string): Promise<VerticalGate | undefined>;
}

export interface ArticleApprovalRepository {
  add(approval: ArticleApproval): Promise<ArticleApproval>;
  getById(id: string): Promise<ArticleApproval | undefined>;
}

export interface PublishPackageRepository {
  add(pkg: PublishPackage): Promise<PublishPackage>;
  getById(id: string): Promise<PublishPackage | undefined>;
  listByScope(scope: TenantScope): Promise<PublishPackage[]>;
}

export interface ChannelNeutralContentPackageRepository {
  add(pkg: ChannelNeutralContentPackage): Promise<ChannelNeutralContentPackage>;
  getById(id: string): Promise<ChannelNeutralContentPackage | undefined>;
  getByPublishPackage(publishPackageId: string): Promise<ChannelNeutralContentPackage | undefined>;
}

export interface DistributionPlanRepository {
  add(plan: DistributionPlan): Promise<DistributionPlan>;
  getById(id: string): Promise<DistributionPlan | undefined>;
  getByChannelNeutralContentPackage(
    channelNeutralContentPackageId: string,
  ): Promise<DistributionPlan | undefined>;
}

/**
 * Delivery / publication-receipt storage. Named `DeliveryRepository` per the
 * checkpoint's port list; it is the append-only home of PublicationReceipts,
 * the terminal artifact of the chain.
 */
export interface DeliveryRepository {
  add(receipt: PublicationReceipt): Promise<PublicationReceipt>;
  listByPlan(distributionPlanId: string): Promise<PublicationReceipt[]>;
  listByScope(scope: TenantScope): Promise<PublicationReceipt[]>;
}
