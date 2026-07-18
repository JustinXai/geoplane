/**
 * PgApplicationCompositionRoot — the real, Postgres-backed wiring of the whole
 * minimal business system, the runtime counterpart to the offline in-memory
 * `ApplicationCompositionRootV1` (./application-composition-root.ts).
 *
 * It composes exactly what the in-memory GEO service test harness
 * (tests/runtime/geo/fakes.ts::buildHarness) composes — all 11 GEO runtime
 * services, each behind the frozen consumer-defined ports of
 * src/runtime/geo/ports.ts — but substitutes the REAL Postgres adapters from
 * src/runtime/geo/pg/*.ts for the in-memory fakes, plus the tenancy repository
 * set (src/persistence/repository-factory.ts) and the knowledge ingestion
 * service backed by the real knowledge Pg repositories.
 *
 * A real GeoRuntimeInfra is provided:
 *   - Clock  : now() = wall-clock `new Date()`.
 *   - IdFactory: next() = `crypto.randomUUID()` (UUIDs land directly in the
 *     UUID primary-key columns the adapters write).
 *   - AuditPort: persists every emitted AuditIntent as a real `audit_event`
 *     row via PgAuditEventRepository, with the tamper-evidence eventHash
 *     computed by the frozen domain helper `recordAuditEvent`
 *     (src/contracts/tenancy/audit.ts).
 *
 * There is NO provider/network port anywhere in this graph — "Provider Calls =
 * 0" is a structural property of the port set, not a runtime counter.
 *
 * Deliberately-transient aggregates. Three GEO ports have NO backing table by
 * design: the geo-business KnowledgePackage / IndustryProfile /
 * ProviderArticleContent aggregates are referenced only by opaque UUID from the
 * persisted tables (see migrations/0003_geo_runtime.sql file header, "Non-FK id
 * references": knowledge_package_id / industry_profile_id / grounding_* are
 * plain UUID columns, NOT foreign keys, because those aggregates "are distinct
 * from D-lane 0002's knowledge_package" and are out of scope for persistence).
 * There is therefore no Pg adapter to substitute for them; this root supplies a
 * small append-only in-memory adapter for each, matching the same append-only
 * contract the ports require (`add` rejects a duplicate id). The durable,
 * client-facing knowledge record is instead the D-lane KnowledgePackage /
 * EnterpriseProfile, which ARE persisted here via the knowledge repositories.
 *
 * Pure wiring only: this module instantiates classes and passes dependencies.
 * It holds no business logic and no app-level singletons — a caller (the E2E
 * test) constructs one runtime per DatabasePort and drives it directly.
 */
import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "../contracts/tenancy/audit.js";
import type { DatabasePort } from "../persistence/database-port.js";
import { PgAuditEventRepository } from "../persistence/pg/audit-event-repository.js";
import { createRepositories, type Repositories } from "../persistence/repository-factory.js";

import type {
  IndustryProfile,
  KnowledgePackage,
  ProviderArticleContent,
} from "../contracts/geo-business/entities.js";
import {
  ArticleBriefService,
  ArticlePipelineService,
  DeliveryService,
  DistributionPlanService,
  HumanReviewService,
  KeywordQuestionService,
  OpportunityFamilyService,
  OpportunityService,
  PublishPackageService,
  QualityGateService,
  ValidationService,
  type AuditIntent,
  type AuditPort,
  type Clock,
  type GeoRuntimeInfra,
  type IdFactory,
  type IndustryProfileRepository,
  type KnowledgePackageRepository,
  type ProviderArticleContentRepository,
} from "../runtime/geo/index.js";

// Real Postgres GEO adapters (migrations 0003 + 0004).
import { PgArticleApprovalRepository } from "../runtime/geo/pg/article-approval-repository.js";
import { PgArticleBriefRepository } from "../runtime/geo/pg/article-brief-repository.js";
import { PgArticleDraftRepository } from "../runtime/geo/pg/article-draft-repository.js";
import { PgChannelNeutralContentPackageRepository } from "../runtime/geo/pg/channel-neutral-content-package-repository.js";
import { PgDeliveryRepository } from "../runtime/geo/pg/delivery-repository.js";
import { PgDistributionPlanRepository } from "../runtime/geo/pg/distribution-plan-repository.js";
import { PgHumanReviewRepository } from "../runtime/geo/pg/human-review-repository.js";
import { PgKeywordQuestionMapRepository } from "../runtime/geo/pg/keyword-question-map-repository.js";
import { PgOpportunityFamilyRepository } from "../runtime/geo/pg/opportunity-family-repository.js";
import { PgOpportunityRepository } from "../runtime/geo/pg/opportunity-repository.js";
import { PgOpportunityValidationRepository } from "../runtime/geo/pg/opportunity-validation-repository.js";
import { PgPlatformGateRepository } from "../runtime/geo/pg/platform-gate-repository.js";
import { PgPublishPackageRepository } from "../runtime/geo/pg/publish-package-repository.js";
import { PgQualityGateRepository } from "../runtime/geo/pg/quality-gate-repository.js";
import { PgVerticalGateRepository } from "../runtime/geo/pg/vertical-gate-repository.js";

// Knowledge ingestion (migration 0002).
import { KnowledgeIngestionService } from "../runtime/knowledge/ingestion/ingestion-service.js";
import {
  InMemoryKnowledgeContentStore,
  type KnowledgeContentStore,
} from "../runtime/knowledge/ingestion/content-store.js";
import { DefaultKnowledgeParser } from "../runtime/knowledge/ingestion/parsers.js";
import { PgKnowledgeDocumentRepository } from "../runtime/knowledge/pg/document-repository.js";
import { PgEnterpriseProfileRepository } from "../runtime/knowledge/pg/enterprise-profile-repository.js";
import { PgKnowledgePackageRepository } from "../runtime/knowledge/pg/package-repository.js";
import { PgKnowledgeVersionRepository } from "../runtime/knowledge/pg/version-repository.js";

// ---------------------------------------------------------------------------
// Infrastructure adapters
// ---------------------------------------------------------------------------

/** Wall-clock. now() is a fresh `Date`; services call `.toISOString()` on it. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Real identity source. Emits RFC-4122 UUIDs, matching the UUID key columns. */
export class RandomUuidFactory implements IdFactory {
  next(): string {
    return randomUUID();
  }
}

/**
 * Persists every emitted GEO `AuditIntent` as a durable `audit_event` row.
 * The tamper-evidence hash is computed by the frozen domain helper
 * `recordAuditEvent` over exactly the fields the AuditEvent contract hashes;
 * we then store the resolved hash verbatim through the append-only repository.
 * The event's owning `organization_id` is the actor's organization (a real org
 * row); the tenant it concerns is carried separately in `client_organization_id`.
 */
export class PgAuditPort implements AuditPort {
  constructor(private readonly auditEvents: PgAuditEventRepository) {}

  async record(intent: AuditIntent): Promise<void> {
    const event = recordAuditEvent({
      organizationId: intent.actorOrganizationId,
      actorUserId: intent.actorUserId,
      actorOrganizationId: intent.actorOrganizationId,
      clientOrganizationId: intent.clientOrganizationId,
      projectId: intent.projectId,
      action: intent.action,
      targetType: intent.targetType,
      targetId: intent.targetId,
      now: new Date(intent.occurredAt),
    });
    await this.auditEvents.append({
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      actorOrganizationId: event.actorOrganizationId,
      clientOrganizationId: event.clientOrganizationId,
      projectId: event.projectId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
      eventHash: event.eventHash,
    });
  }
}

// ---------------------------------------------------------------------------
// Append-only in-memory adapters for the three deliberately-unpersisted GEO
// aggregates (see the module header). Each mirrors the append-only invariant
// of the frozen ports: `add` rejects a duplicate id.
// ---------------------------------------------------------------------------

class AppendOnlyMemStore<T extends { id: string }> {
  private readonly byId = new Map<string, T>();
  add(entity: T): Promise<T> {
    if (this.byId.has(entity.id)) {
      return Promise.reject(
        new Error(`append-only: refusing to overwrite existing id "${entity.id}".`),
      );
    }
    this.byId.set(entity.id, entity);
    return Promise.resolve(entity);
  }
  getById(id: string): Promise<T | undefined> {
    return Promise.resolve(this.byId.get(id));
  }
  filter(pred: (item: T) => boolean): T[] {
    return [...this.byId.values()].filter(pred);
  }
}

class MemKnowledgePackageRepository implements KnowledgePackageRepository {
  private readonly store = new AppendOnlyMemStore<KnowledgePackage>();
  add(kp: KnowledgePackage): Promise<KnowledgePackage> {
    return this.store.add(kp);
  }
  getById(id: string): Promise<KnowledgePackage | undefined> {
    return this.store.getById(id);
  }
  listByScope(scope: {
    clientOrganizationId: string;
    projectId: string;
  }): Promise<KnowledgePackage[]> {
    return Promise.resolve(
      this.store.filter(
        (x) =>
          x.clientOrganizationId === scope.clientOrganizationId &&
          x.projectId === scope.projectId,
      ),
    );
  }
}

class MemIndustryProfileRepository implements IndustryProfileRepository {
  private readonly store = new AppendOnlyMemStore<IndustryProfile>();
  add(profile: IndustryProfile): Promise<IndustryProfile> {
    return this.store.add(profile);
  }
  getById(id: string): Promise<IndustryProfile | undefined> {
    return this.store.getById(id);
  }
}

class MemProviderArticleContentRepository implements ProviderArticleContentRepository {
  private readonly store = new AppendOnlyMemStore<ProviderArticleContent>();
  add(content: ProviderArticleContent): Promise<ProviderArticleContent> {
    return this.store.add(content);
  }
  listByArticleBrief(articleBriefId: string): Promise<ProviderArticleContent[]> {
    return Promise.resolve(this.store.filter((c) => c.articleBriefId === articleBriefId));
  }
}

// ---------------------------------------------------------------------------
// Public shape of the wired runtime
// ---------------------------------------------------------------------------

export interface KnowledgeRuntime {
  readonly packages: PgKnowledgePackageRepository;
  readonly documents: PgKnowledgeDocumentRepository;
  readonly versions: PgKnowledgeVersionRepository;
  readonly enterpriseProfiles: PgEnterpriseProfileRepository;
  readonly contentStore: KnowledgeContentStore;
  readonly ingestion: KnowledgeIngestionService;
}

export interface GeoServices {
  readonly keywordQuestion: KeywordQuestionService;
  readonly opportunity: OpportunityService;
  readonly validation: ValidationService;
  readonly humanReview: HumanReviewService;
  readonly family: OpportunityFamilyService;
  readonly brief: ArticleBriefService;
  readonly pipeline: ArticlePipelineService;
  readonly gates: QualityGateService;
  readonly publish: PublishPackageService;
  readonly distribution: DistributionPlanService;
  readonly delivery: DeliveryService;
}

/**
 * The persistence-facing GEO repositories, exposed so a caller can read
 * artifacts back straight from the database. The three in-memory ones
 * (knowledgePackages / industryProfiles / providerArticleContents) are the
 * deliberately-unpersisted aggregates described in the module header.
 */
export interface GeoRepositories {
  readonly knowledgePackages: KnowledgePackageRepository;
  readonly industryProfiles: IndustryProfileRepository;
  readonly providerArticleContents: ProviderArticleContentRepository;
  readonly keywordQuestionMaps: PgKeywordQuestionMapRepository;
  readonly opportunities: PgOpportunityRepository;
  readonly opportunityValidations: PgOpportunityValidationRepository;
  readonly humanReviews: PgHumanReviewRepository;
  readonly opportunityFamilies: PgOpportunityFamilyRepository;
  readonly articleBriefs: PgArticleBriefRepository;
  readonly articleDrafts: PgArticleDraftRepository;
  readonly qualityGates: PgQualityGateRepository;
  readonly platformGates: PgPlatformGateRepository;
  readonly verticalGates: PgVerticalGateRepository;
  readonly articleApprovals: PgArticleApprovalRepository;
  readonly publishPackages: PgPublishPackageRepository;
  readonly channelNeutralPackages: PgChannelNeutralContentPackageRepository;
  readonly distributionPlans: PgDistributionPlanRepository;
  readonly deliveries: PgDeliveryRepository;
}

export interface PgApplicationRuntime {
  readonly db: DatabasePort;
  readonly infra: GeoRuntimeInfra;
  /** Tenancy repositories (organizations, memberships, projects, invitations, sessions, audit, ...). */
  readonly tenancy: Repositories;
  readonly knowledge: KnowledgeRuntime;
  readonly geo: GeoServices;
  readonly geoRepositories: GeoRepositories;
}

/**
 * Wire a full Postgres-backed application runtime over one DatabasePort. Pure
 * factory: constructs every adapter and service and returns the graph. Applies
 * no migrations and opens no connections of its own — the caller owns the
 * DatabasePort lifecycle.
 */
export function createPgApplicationRuntime(db: DatabasePort): PgApplicationRuntime {
  // Infrastructure.
  const auditEvents = new PgAuditEventRepository(db);
  const infra: GeoRuntimeInfra = {
    clock: new SystemClock(),
    ids: new RandomUuidFactory(),
    audit: new PgAuditPort(auditEvents),
  };

  // Tenancy repository set (organizations / memberships / projects / invitations
  // / sessions / audit events / artifact index), bound to the pool.
  const tenancy = createRepositories(db);

  // Knowledge ingestion, backed by the real knowledge Pg repositories.
  const knowledge: KnowledgeRuntime = (() => {
    const packages = new PgKnowledgePackageRepository(db);
    const documents = new PgKnowledgeDocumentRepository(db);
    const versions = new PgKnowledgeVersionRepository(db);
    const enterpriseProfiles = new PgEnterpriseProfileRepository(db);
    const contentStore = new InMemoryKnowledgeContentStore();
    const ingestion = new KnowledgeIngestionService(
      new DefaultKnowledgeParser(),
      documents,
      versions,
      contentStore,
    );
    return { packages, documents, versions, enterpriseProfiles, contentStore, ingestion };
  })();

  // GEO repositories: 15 real Pg adapters + 3 append-only in-memory adapters
  // for the deliberately-unpersisted, opaque-UUID-referenced aggregates.
  const geoRepositories: GeoRepositories = {
    knowledgePackages: new MemKnowledgePackageRepository(),
    industryProfiles: new MemIndustryProfileRepository(),
    providerArticleContents: new MemProviderArticleContentRepository(),
    keywordQuestionMaps: new PgKeywordQuestionMapRepository(db),
    opportunities: new PgOpportunityRepository(db),
    opportunityValidations: new PgOpportunityValidationRepository(db),
    humanReviews: new PgHumanReviewRepository(db),
    opportunityFamilies: new PgOpportunityFamilyRepository(db),
    articleBriefs: new PgArticleBriefRepository(db),
    articleDrafts: new PgArticleDraftRepository(db),
    qualityGates: new PgQualityGateRepository(db),
    platformGates: new PgPlatformGateRepository(db),
    verticalGates: new PgVerticalGateRepository(db),
    articleApprovals: new PgArticleApprovalRepository(db),
    publishPackages: new PgPublishPackageRepository(db),
    channelNeutralPackages: new PgChannelNeutralContentPackageRepository(db),
    distributionPlans: new PgDistributionPlanRepository(db),
    deliveries: new PgDeliveryRepository(db),
  };

  // The 11 GEO services — identical wiring to tests/runtime/geo/fakes.ts, with
  // real Pg adapters standing in for the in-memory fakes.
  const geo: GeoServices = {
    keywordQuestion: new KeywordQuestionService(
      geoRepositories.knowledgePackages,
      geoRepositories.industryProfiles,
      geoRepositories.keywordQuestionMaps,
      infra,
    ),
    opportunity: new OpportunityService(geoRepositories.opportunities, infra),
    validation: new ValidationService(geoRepositories.opportunityValidations, infra),
    humanReview: new HumanReviewService(geoRepositories.humanReviews, infra),
    family: new OpportunityFamilyService(
      geoRepositories.opportunityFamilies,
      geoRepositories.humanReviews,
      infra,
    ),
    brief: new ArticleBriefService(geoRepositories.articleBriefs, infra),
    pipeline: new ArticlePipelineService(
      geoRepositories.providerArticleContents,
      geoRepositories.articleDrafts,
      infra,
    ),
    gates: new QualityGateService(
      geoRepositories.qualityGates,
      geoRepositories.platformGates,
      geoRepositories.verticalGates,
      geoRepositories.articleApprovals,
      infra,
    ),
    publish: new PublishPackageService(
      geoRepositories.publishPackages,
      geoRepositories.channelNeutralPackages,
      infra,
    ),
    distribution: new DistributionPlanService(geoRepositories.distributionPlans, infra),
    delivery: new DeliveryService(geoRepositories.deliveries, infra),
  };

  return { db, infra, tenancy, knowledge, geo, geoRepositories };
}
