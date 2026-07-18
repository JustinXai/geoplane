/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/app/app/_fixtures.ts, src/app/agency/_fixtures.ts,
 *   src/app/ops/_fixtures.ts (checkpoints C2-C4 - the view-model shapes this service
 *   derives real data into), src/contracts/geo-business/entities.ts (PublicationStatus /
 *   derivePublicationStatus, added during this phase's contract unification)
 * reconstruction_reason: net-new acceptance-phase file (REBUILD_INTEGRATION_ACCEPTANCE_V1,
 *   section 5 "跨 Lane 运行时接线", "FrontendReadModelService")
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * Converts real composed-runtime state (tenancy + GEO business repositories) into the
 * view-model shapes the frontend's per-workspace fixture files hard-code. This does NOT
 * replace those fixture files - C2-C6 remain the frontend's actual, tested, presentation
 * layer, and this phase's mandate (section 一 "阶段结论") explicitly freezes
 * FRONTEND_WORKSPACES_FIXTURE_V1 and forbids "继续横向增加新业务功能" (continuing to add
 * new lateral business features). What this service exists for is section 9's minimal
 * runtime E2E: proving that data created through the real composition-root services is
 * genuinely visible end-to-end ("Client Delivery Center 可看到结果" / "Agency Workspace
 * 可看到客户进度" / "Ops Audit 可看到完整审计链"), using the same tenant-isolation rule
 * (assertCanAccessClientOrganization) the write side already enforces - a read model that
 * bypassed authorization would defeat the entire point of proving isolation end-to-end.
 */
import type { AuthorizationContext, AuditEvent } from "../contracts/tenancy/entities.js";
import { assertCanAccessClientOrganization, isPlatformAdmin } from "../contracts/tenancy/authorization.js";
import type { InMemoryTenancyRepository } from "../contracts/tenancy/in-memory-repository.js";
import type { InMemoryGeoBusinessRepository, TenantScope } from "../contracts/geo-business/repository.js";
import { derivePublicationStatus, type PublicationStatus } from "../contracts/geo-business/entities.js";

export interface ClientDeliveryCenterItemReadModel {
  readonly publishPackageId: string;
  readonly title: string;
  readonly status: PublicationStatus;
  readonly selectedChannelCount: number;
  readonly publishedChannelCount: number;
}

export interface AgencyClientProgressReadModel {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly knowledgePackageCount: number;
  readonly opportunityCount: number;
  readonly approvedArticleCount: number;
  readonly publishedPackageCount: number;
}

export class FrontendReadModelService {
  constructor(
    private readonly tenancyRepository: InMemoryTenancyRepository,
    private readonly geoBusinessRepository: InMemoryGeoBusinessRepository,
  ) {}

  /** "Client Delivery Center 可看到结果" - real PublishPackage/DistributionPlan/PublicationReceipt state, tenant-checked. */
  clientDeliveryCenter(actor: AuthorizationContext, scope: TenantScope): ClientDeliveryCenterItemReadModel[] {
    assertCanAccessClientOrganization(actor, scope.clientOrganizationId);
    return this.geoBusinessRepository.listPublishPackages(scope).map((pkg) => {
      const channelNeutralPackage = this.geoBusinessRepository.getChannelNeutralContentPackageForPublishPackage(pkg.id);
      const plan = channelNeutralPackage
        ? this.geoBusinessRepository.getDistributionPlanForPackage(channelNeutralPackage.id)
        : undefined;
      const receipts = plan ? this.geoBusinessRepository.listPublicationReceiptsForPlan(plan.id) : [];
      return {
        publishPackageId: pkg.id,
        title: pkg.title,
        status: derivePublicationStatus(plan ?? null, receipts),
        selectedChannelCount: plan?.channelIds.length ?? 0,
        publishedChannelCount: receipts.length,
      };
    });
  }

  /**
   * "Agency Workspace 可看到客户进度" - real per-client progress counts, restricted to
   * clients the acting agency actually has an ACTIVE assignment for (never a wildcard
   * "show me every client" - `listOrganizations` already enforces this via B2's
   * `canAccessClientOrganization`, this method just aggregates on top of it). Aggregates
   * across every known tenant scope for each visible CLIENT organization, since this
   * offline model does not track a single canonical project-per-client.
   */
  agencyClientProgress(actor: AuthorizationContext): AgencyClientProgressReadModel[] {
    const visibleClientOrgIds = new Set(
      this.tenancyRepository
        .listOrganizations(actor)
        .filter((o) => o.type === "CLIENT")
        .map((o) => o.id),
    );
    const scopesForVisibleClients = this.geoBusinessRepository
      .listKnownTenantScopes()
      .filter((scope) => visibleClientOrgIds.has(scope.clientOrganizationId));

    return scopesForVisibleClients.map((scope) => ({
      clientOrganizationId: scope.clientOrganizationId,
      projectId: scope.projectId,
      knowledgePackageCount: this.geoBusinessRepository.listKnowledgePackages(scope).length,
      opportunityCount: this.geoBusinessRepository.listOpportunities(scope).length,
      approvedArticleCount: this.geoBusinessRepository.listArticleApprovals(scope).length,
      publishedPackageCount: this.geoBusinessRepository.listPublishPackages(scope).length,
    }));
  }

  /** "Ops Audit 可看到完整审计链" - the real, append-only AuditEvent log for an organization. Platform-admin only. */
  opsAuditTrail(actor: AuthorizationContext, organizationId: string): AuditEvent[] {
    if (!isPlatformAdmin(actor)) {
      throw new Error("opsAuditTrail: only a platform admin may read the full cross-tenant audit trail.");
    }
    return this.tenancyRepository.listAudit(organizationId);
  }
}
