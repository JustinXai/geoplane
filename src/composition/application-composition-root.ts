/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: this phase's own spec, section 5 "跨 Lane 运行时接线" -
 *   "建立 ApplicationCompositionRootV1，至少组合：TenancyRepository / AuthorizationService /
 *   AuditService / KnowledgeService / OpportunityService / HumanReviewService /
 *   ArticlePipelineService / PublicationPackageService / FrontendReadModelService"
 * reconstruction_reason: net-new acceptance-phase file - no lane built a composition root
 *   during the overnight rebuild (B, C, D each stayed independent by design).
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * ApplicationCompositionRootV1: the single place every one of the nine named services
 * gets constructed and wired together. Nothing in this file implements business logic
 * itself - it only instantiates the real classes from src/contracts/tenancy/*.ts,
 * src/contracts/geo-business/*.ts, and ./geo-business-services.ts /
 * ./frontend-read-model-service.ts, and passes each service the repositories it needs.
 *
 * This is still an OFFLINE composition root: `InMemoryTenancyRepository` and
 * `InMemoryGeoBusinessRepository` are Map-backed, no real database. Section 6 of this
 * phase (real PostgreSQL 16 verification) is a separate, standalone verification of the
 * migration SQL - it does not (yet) mean this composition root is Postgres-backed. A
 * future checkpoint swapping in a real repository implementation is expected to satisfy
 * the exact same method signatures these in-memory repositories already expose.
 */
import { InMemoryTenancyRepository } from "../contracts/tenancy/in-memory-repository.js";
import { InMemoryGeoBusinessRepository } from "../contracts/geo-business/repository.js";
import * as authorizationService from "../contracts/tenancy/authorization.js";
import {
  KnowledgeService,
  OpportunityService,
  HumanReviewService,
  ArticlePipelineService,
  PublicationPackageService,
} from "./geo-business-services.js";
import { FrontendReadModelService } from "./frontend-read-model-service.js";

export class ApplicationCompositionRootV1 {
  /** B1-B5: organizations, membership, sessions, invitations, and the append-only audit log. */
  readonly tenancyRepository: InMemoryTenancyRepository;
  /** B2: fail-closed tenant-isolation checks. Not a class - re-exported as a namespace since authorization.ts is pure functions, no state to compose. */
  readonly authorizationService: typeof authorizationService;
  /** B4: audit-event hashing/recording. Composed via tenancyRepository.recordAudit - see that method's doc comment for why it, not a separate AuditService class, is the real public entry point. */
  readonly auditService: Pick<InMemoryTenancyRepository, "recordAudit" | "listAudit">;

  readonly knowledgeService: KnowledgeService;
  readonly opportunityService: OpportunityService;
  readonly humanReviewService: HumanReviewService;
  readonly articlePipelineService: ArticlePipelineService;
  readonly publicationPackageService: PublicationPackageService;
  readonly frontendReadModelService: FrontendReadModelService;

  /** Exposed for tests/E2E scenarios that need to inspect raw GEO-business state directly. */
  readonly geoBusinessRepository: InMemoryGeoBusinessRepository;

  constructor() {
    this.tenancyRepository = new InMemoryTenancyRepository();
    this.geoBusinessRepository = new InMemoryGeoBusinessRepository();
    this.authorizationService = authorizationService;
    this.auditService = this.tenancyRepository;

    this.knowledgeService = new KnowledgeService(this.geoBusinessRepository, this.tenancyRepository);
    this.opportunityService = new OpportunityService(this.geoBusinessRepository, this.tenancyRepository);
    this.humanReviewService = new HumanReviewService(this.geoBusinessRepository, this.tenancyRepository);
    this.articlePipelineService = new ArticlePipelineService(this.geoBusinessRepository, this.tenancyRepository);
    this.publicationPackageService = new PublicationPackageService(this.geoBusinessRepository, this.tenancyRepository);
    this.frontendReadModelService = new FrontendReadModelService(this.tenancyRepository, this.geoBusinessRepository);
  }
}

/** Convenience factory, mirroring the naming the spec uses ("建立 ApplicationCompositionRootV1"). */
export function createApplicationCompositionRoot(): ApplicationCompositionRootV1 {
  return new ApplicationCompositionRootV1();
}
