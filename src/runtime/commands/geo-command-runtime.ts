/**
 * Lane-local GEO command runtime for BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * The write-side counterpart the GEO business-chain command routes stand on. It composes
 * exactly the 11 GEO runtime services the frozen composition root composes
 * (src/composition/pg-application-runtime.ts), but binds every Pg adapter to a caller-supplied
 * `Queryable` — so the whole graph can execute inside ONE command transaction (the `ctx.tx`
 * `runWriteCommand` hands to a `perform` closure). No app-level singleton, no provider/network
 * port anywhere in the graph — "Provider Calls = 0" is structural, exactly as in the composition.
 *
 * It provides three things the GEO command handlers need on top of batch-1's runWriteCommand:
 *
 *   1. createGeoCommandRuntime(q) — the geo repositories + the 11 geo services + a GeoRuntimeInfra
 *      whose AuditPort persists each emitted domain AuditIntent as a real audit_event row (the
 *      composition's PgAuditPort, re-expressed here over the transaction's Queryable), PLUS the
 *      knowledge PgKnowledgePackageRepository and an audited createKnowledgePackage/confirm that
 *      mirror the composition's audited createPackage — the knowledge-audit-gap closure.
 *   2. buildGeoAuthorizationContext(session) — maps the server-resolved AuthenticatedSession onto
 *      the frozen AuthorizationContext the geo services gate every action on
 *      (assertCanAccessClientOrganization). Identity/grants come ONLY from the session.
 *   3. sessionCanAccessClientOrganization(session, clientOrgId) — the route-level pre-flight tenant
 *      check (same rule as the AuthorizationContext one), used to 403 + DENIED a cross-tenant write
 *      before opening the write transaction.
 *
 * Server-side tenant resolution (SYSTEM_INVARIANTS_V1.md): nothing here reads a caller-supplied
 * organization id. The tenant a command touches is always re-derived by the route from the
 * session (project-scoped routes) or from the server-persisted client_organization_id of the
 * referenced artifact (entity-scoped routes), never trusted from request input.
 */
import { randomUUID } from "node:crypto";
import type { AuthorizationContext, PlatformRole } from "../../contracts/tenancy/entities.js";
import { AuthorizationDeniedError } from "../../contracts/tenancy/authorization.js";
import { recordAuditEvent } from "../../contracts/tenancy/audit.js";
import type {
  DatabasePort,
  DbQueryResult,
  Queryable,
  SqlParam,
  TransactionPort,
} from "../../persistence/database-port.js";
import { PgAuditEventRepository } from "../../persistence/pg/audit-event-repository.js";
import { KnowledgePackageBridge } from "../../persistence/runtime-continuity/knowledge-package-bridge.js";
import { PgIndustryProfileRepository } from "../../persistence/runtime-continuity/industry-profile-repository.js";
import { PgProviderArticleContentRepository } from "../../persistence/runtime-continuity/provider-article-content-repository.js";
import type { AuthenticatedSession } from "../auth/auth-service.js";
import {
  ArticleBriefService,
  ArticlePipelineService,
  DeliveryService,
  DistributionPlanService,
  HumanReviewService,
  KeywordQuestionService,
  OfflineDraftGenerator,
  OpportunityFamilyService,
  OpportunityService,
  OpportunityToArticleBriefAdapter,
  PublishPackageService,
  QualityGateService,
  ValidationService,
  type AuditIntent,
  type AuditPort,
  type Clock,
  type GeoRuntimeInfra,
  type IdFactory,
} from "../geo/index.js";
import { PgArticleApprovalRepository } from "../geo/pg/article-approval-repository.js";
import { PgArticleBriefRepository } from "../geo/pg/article-brief-repository.js";
import { PgArticleDraftRepository } from "../geo/pg/article-draft-repository.js";
import { PgChannelNeutralContentPackageRepository } from "../geo/pg/channel-neutral-content-package-repository.js";
import { PgDistributionPlanRepository } from "../geo/pg/distribution-plan-repository.js";
import { PgHumanReviewRepository } from "../geo/pg/human-review-repository.js";
import { PgKeywordQuestionMapRepository } from "../geo/pg/keyword-question-map-repository.js";
import { PgOpportunityFamilyRepository } from "../geo/pg/opportunity-family-repository.js";
import { PgOpportunityRepository } from "../geo/pg/opportunity-repository.js";
import { PgOpportunityValidationRepository } from "../geo/pg/opportunity-validation-repository.js";
import { PgPlatformGateRepository } from "../geo/pg/platform-gate-repository.js";
import { PgPublishPackageRepository } from "../geo/pg/publish-package-repository.js";
import { PgQualityGateRepository } from "../geo/pg/quality-gate-repository.js";
import { PgVerticalGateRepository } from "../geo/pg/vertical-gate-repository.js";
import { PgDeliveryRepository } from "../geo/pg/delivery-repository.js";
import { PgKnowledgePackageRepository } from "../knowledge/pg/package-repository.js";
import type { KnowledgePackage as KnowledgeAggregate } from "../knowledge/entities.js";
import { CommandAbortError } from "./runtime-context.js";

const AGENCY_ROLES: readonly PlatformRole[] = ["AGENCY_OWNER", "AGENCY_OPERATOR"];

/**
 * Adapts a live transaction handle (a bare `Queryable`, e.g. the `ctx.tx` runWriteCommand hands a
 * `perform` closure) up to the full `DatabasePort` a handful of the frozen geo adapters demand
 * (keyword-map / opportunity-family / channel-neutral / delivery — each writes several tables and
 * insists on owning a transaction). Its `transaction()` does NOT open a nested BEGIN: it runs the
 * work on the SAME outer transaction, so those multi-table writes participate in the one command
 * transaction (atomic with the command audit + idempotency ledger) rather than committing on a
 * separate connection. `close()` is a no-op — the outer owner manages the pool lifecycle.
 */
class OuterTransactionDatabasePort implements DatabasePort {
  constructor(private readonly tx: Queryable) {}
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly SqlParam[],
  ): Promise<DbQueryResult<T>> {
    return this.tx.query<T>(text, params);
  }
  transaction<T>(work: (tx: TransactionPort) => Promise<T>): Promise<T> {
    return work(this.tx);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** A real DatabasePort passes through; a bare transaction handle is adapted up to one. */
function toDatabasePort(source: Queryable): DatabasePort {
  return typeof (source as Partial<DatabasePort>).transaction === "function"
    ? (source as DatabasePort)
    : new OuterTransactionDatabasePort(source);
}

// ---------------------------------------------------------------------------
// Infrastructure adapters (mirror the composition's, re-bound to a Queryable)
// ---------------------------------------------------------------------------

/** Wall-clock. now() is a fresh Date; services call `.toISOString()` on it. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Real identity source — RFC-4122 UUIDs, matching the UUID key columns. */
export class RandomUuidFactory implements IdFactory {
  next(): string {
    return randomUUID();
  }
}

/**
 * Persists every emitted GEO AuditIntent as a durable audit_event row, with the tamper-evidence
 * hash computed by the frozen `recordAuditEvent`. Identical semantics to the composition's
 * PgAuditPort, but bound to the command transaction's Queryable so the domain audit commits
 * atomically with the write it describes.
 */
export class PgCommandAuditPort implements AuditPort {
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
// The wired geo command runtime
// ---------------------------------------------------------------------------

export interface GeoCommandRepositories {
  readonly knowledgePackages: KnowledgePackageBridge;
  readonly industryProfiles: PgIndustryProfileRepository;
  readonly providerArticleContents: PgProviderArticleContentRepository;
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

export interface GeoCommandServices {
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
  /** Bridges a knowledge-driven Opportunity to an ArticleBrief atomically. */
  readonly opportunityToBrief: OpportunityToArticleBriefAdapter;
  /** Offline draft generator for when the provider runtime is disabled. */
  readonly offline: OfflineDraftGenerator;
}

export interface CreateKnowledgePackageCommandInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly createdByUserId: string;
}

export interface GeoCommandRuntime {
  readonly infra: GeoRuntimeInfra;
  readonly repos: GeoCommandRepositories;
  readonly services: GeoCommandServices;
  /** The knowledge runtime's canonical package repository (knowledge_package, migration 0002). */
  readonly knowledgePackageStore: PgKnowledgePackageRepository;
  /**
   * Creates a knowledge package AND emits a `knowledge_package.created` audit event with the real
   * creating actor — mirrors the composition's audited createPackage, closing the audit gap on the
   * knowledge write path from a command route this lane owns.
   */
  createKnowledgePackage(input: CreateKnowledgePackageCommandInput): Promise<KnowledgeAggregate>;
  /**
   * Confirms (seals) a knowledge package AND emits a `knowledge_package.confirmed` audit event with
   * the real confirming actor — the audited confirm counterpart.
   */
  confirmKnowledgePackage(
    packageId: string,
    confirmedByUserId: string,
    tenant: { clientOrganizationId: string; projectId: string },
  ): Promise<KnowledgeAggregate>;
}

/**
 * Wire a GEO command runtime over one Queryable (a command transaction or the pool). Pure factory:
 * constructs every adapter and service and returns the graph. Mirrors the geo section of
 * createPgApplicationRuntime, re-bound to `q`.
 */
export function createGeoCommandRuntime(source: Queryable): GeoCommandRuntime {
  const db = toDatabasePort(source);
  const auditEvents = new PgAuditEventRepository(db);
  const infra: GeoRuntimeInfra = {
    clock: new SystemClock(),
    ids: new RandomUuidFactory(),
    audit: new PgCommandAuditPort(auditEvents),
  };

  const repos: GeoCommandRepositories = {
    knowledgePackages: new KnowledgePackageBridge(db),
    industryProfiles: new PgIndustryProfileRepository(db),
    providerArticleContents: new PgProviderArticleContentRepository(db),
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

  const services: GeoCommandServices = {
    keywordQuestion: new KeywordQuestionService(
      repos.knowledgePackages,
      repos.industryProfiles,
      repos.keywordQuestionMaps,
      infra,
    ),
    opportunity: new OpportunityService(repos.opportunities, infra),
    validation: new ValidationService(repos.opportunityValidations, infra),
    humanReview: new HumanReviewService(repos.humanReviews, infra),
    family: new OpportunityFamilyService(repos.opportunityFamilies, repos.humanReviews, infra),
    brief: new ArticleBriefService(repos.articleBriefs, infra),
    pipeline: new ArticlePipelineService(repos.providerArticleContents, repos.articleDrafts, infra),
    gates: new QualityGateService(
      repos.qualityGates,
      repos.platformGates,
      repos.verticalGates,
      repos.articleApprovals,
      infra,
    ),
    publish: new PublishPackageService(repos.publishPackages, repos.channelNeutralPackages, infra),
    distribution: new DistributionPlanService(repos.distributionPlans, infra),
    delivery: new DeliveryService(repos.deliveries, infra),
    opportunityToBrief: new OpportunityToArticleBriefAdapter(
      repos.opportunities,
      repos.opportunityValidations,
      repos.humanReviews,
      repos.opportunityFamilies,
      repos.articleBriefs,
      infra,
    ),
    offline: new OfflineDraftGenerator(repos.providerArticleContents, repos.articleDrafts, infra),
  };

  const knowledgePackageStore = new PgKnowledgePackageRepository(db);

  const createKnowledgePackage: GeoCommandRuntime["createKnowledgePackage"] = async (input) => {
    const pkg = await knowledgePackageStore.create({
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      title: input.title,
      createdByUserId: input.createdByUserId,
    });
    await infra.audit.record({
      actorUserId: input.createdByUserId,
      actorOrganizationId: input.clientOrganizationId,
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      action: "knowledge_package.created",
      targetType: "knowledge_package",
      targetId: pkg.id,
      occurredAt: infra.clock.now().toISOString(),
    });
    return pkg;
  };

  const confirmKnowledgePackage: GeoCommandRuntime["confirmKnowledgePackage"] = async (
    packageId,
    confirmedByUserId,
    tenant,
  ) => {
    const pkg = await knowledgePackageStore.confirm(packageId, confirmedByUserId);
    await infra.audit.record({
      actorUserId: confirmedByUserId,
      actorOrganizationId: tenant.clientOrganizationId,
      clientOrganizationId: tenant.clientOrganizationId,
      projectId: tenant.projectId,
      action: "knowledge_package.confirmed",
      targetType: "knowledge_package",
      targetId: pkg.id,
      occurredAt: infra.clock.now().toISOString(),
    });
    return pkg;
  };

  return {
    infra,
    repos,
    services,
    knowledgePackageStore,
    createKnowledgePackage,
    confirmKnowledgePackage,
  };
}

// ---------------------------------------------------------------------------
// Session -> authorization mapping (identity/grants come ONLY from the session)
// ---------------------------------------------------------------------------

/** The single ACTIVE client org a CLIENT principal operates under (their own org). */
function clientOrgOf(session: AuthenticatedSession): string | null {
  if (session.organizationType !== "CLIENT") return session.activeClientOrganizationId;
  return session.activeClientOrganizationId ?? session.organizationId;
}

/**
 * Maps a server-resolved AuthenticatedSession onto the frozen AuthorizationContext the geo
 * services gate every action on. Nothing here is read from request input.
 */
export function buildGeoAuthorizationContext(session: AuthenticatedSession): AuthorizationContext {
  const assigned = [...session.assignedClientOrganizationIds];
  return {
    actorUserId: session.userId,
    actorRole: session.role,
    organizationId: session.organizationId,
    organizationType: session.organizationType,
    activeProjectId: null,
    activeClientOrganizationId: clientOrgOf(session),
    assignedClientOrganizationIds: assigned,
    allowedClientOrganizationIds: assigned,
    isPlatformAdmin: session.role === "PLATFORM_SUPER_ADMIN",
    permissions: [],
  };
}

/**
 * Route-level pre-flight tenant check — the same rule the geo services enforce, applied before the
 * write transaction so a cross-tenant write is 403 + DENIED-audited without any partial work:
 *   - PLATFORM_SUPER_ADMIN may write for any client org;
 *   - a CLIENT principal only its own client org;
 *   - an AGENCY principal only clients it is ACTIVE-assigned to.
 */
export function sessionCanAccessClientOrganization(
  session: AuthenticatedSession,
  clientOrganizationId: string,
): boolean {
  if (session.role === "PLATFORM_SUPER_ADMIN") return true;
  if (session.organizationType === "CLIENT") {
    return clientOrgOf(session) === clientOrganizationId;
  }
  if (AGENCY_ROLES.includes(session.role)) {
    return session.assignedClientOrganizationIds.includes(clientOrganizationId);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Domain-error translation
// ---------------------------------------------------------------------------

/**
 * Runs a domain service call, translating a thrown invariant violation into the canonical HTTP
 * error envelope so the route returns 4xx (not 500): an AuthorizationDeniedError -> FORBIDDEN (the
 * geo tenant guard), any other Error -> VALIDATION_FAILED (a rejected cross-entity invariant, e.g.
 * "keyword not in map", "decision not APPROVED", "actor is automatic"). A CommandAbortError raised
 * by the caller passes through untouched. Because it throws out of the `perform` closure, the whole
 * command transaction rolls back — no half-written artifact, no spurious ALLOWED audit.
 */
export async function invokeDomain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CommandAbortError) throw err;
    if (err instanceof AuthorizationDeniedError) {
      throw new CommandAbortError("FORBIDDEN", err.message);
    }
    if (err instanceof Error) {
      throw new CommandAbortError("VALIDATION_FAILED", err.message);
    }
    throw err;
  }
}
