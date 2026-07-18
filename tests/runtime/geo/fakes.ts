/**
 * In-memory fakes + fixtures for GEO runtime service unit tests. No database,
 * no real async I/O. Every repository fake is APPEND-ONLY: `add` rejects a
 * duplicate id, so a test cannot silently overwrite (mutate) a stored artifact
 * — the "historical artifacts are never mutated" invariant is enforced by the
 * fakes themselves, not just asserted.
 */
import type { AuthorizationContext, PlatformRole } from "../../../src/contracts/tenancy/entities.js";
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
} from "../../../src/contracts/geo-business/entities.js";
import type {
  ArticleApprovalRepository,
  ArticleBriefRepository,
  ArticleDraftRepository,
  AuditIntent,
  AuditPort,
  ChannelNeutralContentPackageRepository,
  Clock,
  DeliveryRepository,
  DistributionPlanRepository,
  HumanReviewRepository,
  IdFactory,
  IndustryProfileRepository,
  KeywordQuestionMapRepository,
  KnowledgePackageRepository,
  OpportunityFamilyRepository,
  OpportunityRepository,
  OpportunityValidationRepository,
  PlatformGateRepository,
  ProviderArticleContentRepository,
  PublishPackageRepository,
  QualityGateRepository,
  TenantScope,
  VerticalGateRepository,
} from "../../../src/runtime/geo/ports.js";
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
  type GeoRuntimeInfra,
} from "../../../src/runtime/geo/index.js";

// ---------------------------------------------------------------------------
// Infrastructure fakes
// ---------------------------------------------------------------------------

/** Deterministic, monotonically increasing id source. */
export class SequentialIdFactory implements IdFactory {
  private counter = 0;
  constructor(private readonly prefix: string = "id") {}
  next(): string {
    this.counter += 1;
    return `${this.prefix}_${this.counter}`;
  }
}

/** Fixed clock — every `now()` returns the same instant unless `set` is called. */
export class FixedClock implements Clock {
  constructor(private current: Date = new Date("2026-01-01T00:00:00.000Z")) {}
  now(): Date {
    return this.current;
  }
  set(next: Date): void {
    this.current = next;
  }
}

/** Collects every emitted audit intent for assertion. */
export class RecordingAuditPort implements AuditPort {
  readonly intents: AuditIntent[] = [];
  record(intent: AuditIntent): Promise<void> {
    this.intents.push(intent);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Append-only store + repository fakes
// ---------------------------------------------------------------------------

function sameTenant(item: { clientOrganizationId: string; projectId: string }, scope: TenantScope): boolean {
  return item.clientOrganizationId === scope.clientOrganizationId && item.projectId === scope.projectId;
}

class AppendOnlyStore<T extends { id: string }> {
  private readonly byId = new Map<string, T>();

  add(entity: T): Promise<T> {
    if (this.byId.has(entity.id)) {
      return Promise.reject(
        new Error(`AppendOnlyStore: refusing to overwrite existing id "${entity.id}" (append-only).`),
      );
    }
    this.byId.set(entity.id, entity);
    return Promise.resolve(entity);
  }
  getById(id: string): Promise<T | undefined> {
    return Promise.resolve(this.byId.get(id));
  }
  all(): T[] {
    return [...this.byId.values()];
  }
}

export class FakeKnowledgePackageRepository implements KnowledgePackageRepository {
  private readonly store = new AppendOnlyStore<KnowledgePackage>();
  add(kp: KnowledgePackage): Promise<KnowledgePackage> {
    return this.store.add(kp);
  }
  getById(id: string): Promise<KnowledgePackage | undefined> {
    return this.store.getById(id);
  }
  listByScope(scope: TenantScope): Promise<KnowledgePackage[]> {
    return Promise.resolve(this.store.all().filter((x) => sameTenant(x, scope)));
  }
}

export class FakeIndustryProfileRepository implements IndustryProfileRepository {
  private readonly store = new AppendOnlyStore<IndustryProfile>();
  add(profile: IndustryProfile): Promise<IndustryProfile> {
    return this.store.add(profile);
  }
  getById(id: string): Promise<IndustryProfile | undefined> {
    return this.store.getById(id);
  }
}

export class FakeKeywordQuestionMapRepository implements KeywordQuestionMapRepository {
  private readonly store = new AppendOnlyStore<KeywordQuestionMap>();
  add(map: KeywordQuestionMap): Promise<KeywordQuestionMap> {
    return this.store.add(map);
  }
  getById(id: string): Promise<KeywordQuestionMap | undefined> {
    return this.store.getById(id);
  }
  listByScope(scope: TenantScope): Promise<KeywordQuestionMap[]> {
    return Promise.resolve(this.store.all().filter((x) => sameTenant(x, scope)));
  }
}

export class FakeOpportunityRepository implements OpportunityRepository {
  private readonly store = new AppendOnlyStore<Opportunity>();
  add(opportunity: Opportunity): Promise<Opportunity> {
    return this.store.add(opportunity);
  }
  getById(id: string): Promise<Opportunity | undefined> {
    return this.store.getById(id);
  }
  listByScope(scope: TenantScope): Promise<Opportunity[]> {
    return Promise.resolve(this.store.all().filter((x) => sameTenant(x, scope)));
  }
}

export class FakeOpportunityValidationRepository implements OpportunityValidationRepository {
  private readonly store = new AppendOnlyStore<OpportunityValidation>();
  add(validation: OpportunityValidation): Promise<OpportunityValidation> {
    return this.store.add(validation);
  }
  getById(id: string): Promise<OpportunityValidation | undefined> {
    return this.store.getById(id);
  }
}

export class FakeHumanReviewRepository implements HumanReviewRepository {
  private readonly store = new AppendOnlyStore<HumanReviewDecision>();
  add(decision: HumanReviewDecision): Promise<HumanReviewDecision> {
    return this.store.add(decision);
  }
  getById(id: string): Promise<HumanReviewDecision | undefined> {
    return this.store.getById(id);
  }
  listByScope(scope: TenantScope): Promise<HumanReviewDecision[]> {
    return Promise.resolve(this.store.all().filter((x) => sameTenant(x, scope)));
  }
}

export class FakeOpportunityFamilyRepository implements OpportunityFamilyRepository {
  private readonly store = new AppendOnlyStore<OpportunityFamily>();
  add(family: OpportunityFamily): Promise<OpportunityFamily> {
    return this.store.add(family);
  }
  getById(id: string): Promise<OpportunityFamily | undefined> {
    return this.store.getById(id);
  }
}

export class FakeArticleBriefRepository implements ArticleBriefRepository {
  private readonly store = new AppendOnlyStore<ArticleBrief>();
  add(brief: ArticleBrief): Promise<ArticleBrief> {
    return this.store.add(brief);
  }
  getById(id: string): Promise<ArticleBrief | undefined> {
    return this.store.getById(id);
  }
}

export class FakeProviderArticleContentRepository implements ProviderArticleContentRepository {
  private readonly store = new AppendOnlyStore<ProviderArticleContent>();
  add(content: ProviderArticleContent): Promise<ProviderArticleContent> {
    return this.store.add(content);
  }
  listByArticleBrief(articleBriefId: string): Promise<ProviderArticleContent[]> {
    return Promise.resolve(this.store.all().filter((c) => c.articleBriefId === articleBriefId));
  }
}

export class FakeArticleDraftRepository implements ArticleDraftRepository {
  private readonly store = new AppendOnlyStore<ArticleDraft>();
  add(draft: ArticleDraft): Promise<ArticleDraft> {
    return this.store.add(draft);
  }
  getById(id: string): Promise<ArticleDraft | undefined> {
    return this.store.getById(id);
  }
  listByArticleBrief(articleBriefId: string): Promise<ArticleDraft[]> {
    return Promise.resolve(this.store.all().filter((d) => d.articleBriefId === articleBriefId));
  }
}

export class FakeQualityGateRepository implements QualityGateRepository {
  private readonly store = new AppendOnlyStore<QualityGate>();
  add(gate: QualityGate): Promise<QualityGate> {
    return this.store.add(gate);
  }
  getById(id: string): Promise<QualityGate | undefined> {
    return this.store.getById(id);
  }
}

export class FakePlatformGateRepository implements PlatformGateRepository {
  private readonly store = new AppendOnlyStore<PlatformGate>();
  add(gate: PlatformGate): Promise<PlatformGate> {
    return this.store.add(gate);
  }
  getById(id: string): Promise<PlatformGate | undefined> {
    return this.store.getById(id);
  }
}

export class FakeVerticalGateRepository implements VerticalGateRepository {
  private readonly store = new AppendOnlyStore<VerticalGate>();
  add(gate: VerticalGate): Promise<VerticalGate> {
    return this.store.add(gate);
  }
  getById(id: string): Promise<VerticalGate | undefined> {
    return this.store.getById(id);
  }
}

export class FakeArticleApprovalRepository implements ArticleApprovalRepository {
  private readonly store = new AppendOnlyStore<ArticleApproval>();
  add(approval: ArticleApproval): Promise<ArticleApproval> {
    return this.store.add(approval);
  }
  getById(id: string): Promise<ArticleApproval | undefined> {
    return this.store.getById(id);
  }
}

export class FakePublishPackageRepository implements PublishPackageRepository {
  private readonly store = new AppendOnlyStore<PublishPackage>();
  add(pkg: PublishPackage): Promise<PublishPackage> {
    return this.store.add(pkg);
  }
  getById(id: string): Promise<PublishPackage | undefined> {
    return this.store.getById(id);
  }
  listByScope(scope: TenantScope): Promise<PublishPackage[]> {
    return Promise.resolve(this.store.all().filter((x) => sameTenant(x, scope)));
  }
}

export class FakeChannelNeutralContentPackageRepository
  implements ChannelNeutralContentPackageRepository
{
  private readonly store = new AppendOnlyStore<ChannelNeutralContentPackage>();
  add(pkg: ChannelNeutralContentPackage): Promise<ChannelNeutralContentPackage> {
    return this.store.add(pkg);
  }
  getById(id: string): Promise<ChannelNeutralContentPackage | undefined> {
    return this.store.getById(id);
  }
  getByPublishPackage(publishPackageId: string): Promise<ChannelNeutralContentPackage | undefined> {
    return Promise.resolve(this.store.all().find((p) => p.publishPackageId === publishPackageId));
  }
}

export class FakeDistributionPlanRepository implements DistributionPlanRepository {
  private readonly store = new AppendOnlyStore<DistributionPlan>();
  add(plan: DistributionPlan): Promise<DistributionPlan> {
    return this.store.add(plan);
  }
  getById(id: string): Promise<DistributionPlan | undefined> {
    return this.store.getById(id);
  }
  getByChannelNeutralContentPackage(
    channelNeutralContentPackageId: string,
  ): Promise<DistributionPlan | undefined> {
    return Promise.resolve(
      this.store.all().find((p) => p.channelNeutralContentPackageId === channelNeutralContentPackageId),
    );
  }
}

export class FakeDeliveryRepository implements DeliveryRepository {
  private readonly store = new AppendOnlyStore<PublicationReceipt>();
  add(receipt: PublicationReceipt): Promise<PublicationReceipt> {
    return this.store.add(receipt);
  }
  listByPlan(distributionPlanId: string): Promise<PublicationReceipt[]> {
    return Promise.resolve(this.store.all().filter((r) => r.distributionPlanId === distributionPlanId));
  }
  listByScope(scope: TenantScope): Promise<PublicationReceipt[]> {
    return Promise.resolve(this.store.all().filter((x) => sameTenant(x, scope)));
  }
}

// ---------------------------------------------------------------------------
// Offline provider fixture — proves Provider Calls = 0
// ---------------------------------------------------------------------------

/**
 * A deterministic, OFFLINE stand-in for whatever would eventually produce a
 * provider envelope. It performs no network I/O. A test seeds provider content
 * by calling `generateEnvelopeId` itself, records the resulting `callCount`,
 * then runs the whole service pipeline and asserts `callCount` did not
 * increase — proving the services never invoke a provider.
 */
export class OfflineProviderFixture {
  callCount = 0;
  private seq = 0;
  generateEnvelopeId(): string {
    this.callCount += 1;
    this.seq += 1;
    return `offline_envelope_${this.seq}`;
  }
}

// ---------------------------------------------------------------------------
// AuthorizationContext fixtures
// ---------------------------------------------------------------------------

/**
 * A CLIENT_OWNER context fixed to a single active client org — the strictest
 * tenant boundary. It can only ever reach `clientOrganizationId`.
 */
export function clientOwnerContext(
  clientOrganizationId: string,
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  const role: PlatformRole = "CLIENT_OWNER";
  return {
    actorUserId: "user_client_owner",
    actorRole: role,
    organizationId: clientOrganizationId,
    organizationType: "CLIENT",
    activeProjectId: null,
    activeClientOrganizationId: clientOrganizationId,
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: false,
    permissions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Infra bundle helper
// ---------------------------------------------------------------------------

export interface TestInfra extends GeoRuntimeInfra {
  readonly clock: FixedClock;
  readonly ids: SequentialIdFactory;
  readonly audit: RecordingAuditPort;
}

export function makeInfra(idPrefix = "id"): TestInfra {
  return {
    clock: new FixedClock(),
    ids: new SequentialIdFactory(idPrefix),
    audit: new RecordingAuditPort(),
  };
}

// ---------------------------------------------------------------------------
// Fully-wired service harness (shared across test files)
// ---------------------------------------------------------------------------

export const ORG = "org_client_acme";
export const PROJECT = "proj_acme_main";

export interface Harness {
  readonly infra: TestInfra;
  readonly provider: OfflineProviderFixture;
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
  /** Exposed so a test can seed/inspect human-review decisions directly. */
  readonly humanReviewRepo: FakeHumanReviewRepository;
}

export function buildHarness(idPrefix = "id"): Harness {
  const infra = makeInfra(idPrefix);
  const humanReviewRepo = new FakeHumanReviewRepository();
  return {
    infra,
    provider: new OfflineProviderFixture(),
    keywordQuestion: new KeywordQuestionService(
      new FakeKnowledgePackageRepository(),
      new FakeIndustryProfileRepository(),
      new FakeKeywordQuestionMapRepository(),
      infra,
    ),
    opportunity: new OpportunityService(new FakeOpportunityRepository(), infra),
    validation: new ValidationService(new FakeOpportunityValidationRepository(), infra),
    humanReview: new HumanReviewService(humanReviewRepo, infra),
    family: new OpportunityFamilyService(
      new FakeOpportunityFamilyRepository(),
      humanReviewRepo,
      infra,
    ),
    brief: new ArticleBriefService(new FakeArticleBriefRepository(), infra),
    pipeline: new ArticlePipelineService(
      new FakeProviderArticleContentRepository(),
      new FakeArticleDraftRepository(),
      infra,
    ),
    gates: new QualityGateService(
      new FakeQualityGateRepository(),
      new FakePlatformGateRepository(),
      new FakeVerticalGateRepository(),
      new FakeArticleApprovalRepository(),
      infra,
    ),
    publish: new PublishPackageService(
      new FakePublishPackageRepository(),
      new FakeChannelNeutralContentPackageRepository(),
      infra,
    ),
    distribution: new DistributionPlanService(new FakeDistributionPlanRepository(), infra),
    delivery: new DeliveryService(new FakeDeliveryRepository(), infra),
    humanReviewRepo,
  };
}
