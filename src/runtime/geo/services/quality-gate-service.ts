/**
 * QualityGateService — evaluates the three publication gates and produces the
 * final ArticleApproval (chain item 10, "Quality gates").
 *
 *  - `evaluateQualityGate` delegates to the frozen pure evaluator.
 *  - `evaluatePlatformGate` / `evaluateVerticalGate` follow the exact same
 *    determinism discipline (no I/O, no clock/random inside — identity/time
 *    injected): the frozen contract defined the PlatformGate/VerticalGate
 *    OUTCOME shapes but shipped no evaluator for them, so the deterministic
 *    check lives here.
 *  - `approveArticle` is gated on all three gates having passed. Each gate
 *    parameter is typed to the PASSED variant only (`Extract<_, {status:
 *    "PASSED"}>`), so a FAILED or missing gate does not type-check — the gating
 *    is structural, not a runtime-only check. A defensive runtime guard also
 *    re-verifies the gates belong to the draft being approved.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import {
  evaluateQualityGate,
  type ArticleApproval,
  type ArticleBrief,
  type ArticleDraft,
  type IndustryProfile,
  type PlatformGate,
  type QualityGate,
  type VerticalGate,
} from "../../../contracts/geo-business/entities.js";
import type {
  ArticleApprovalRepository,
  PlatformGateRepository,
  QualityGateRepository,
  VerticalGateRepository,
} from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

type PassedQualityGate = Extract<QualityGate, { status: "PASSED" }>;
type PassedPlatformGate = Extract<PlatformGate, { status: "PASSED" }>;
type PassedVerticalGate = Extract<VerticalGate, { status: "PASSED" }>;

export class QualityGateService {
  constructor(
    private readonly qualityGates: QualityGateRepository,
    private readonly platformGates: PlatformGateRepository,
    private readonly verticalGates: VerticalGateRepository,
    private readonly approvals: ArticleApprovalRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async evaluateQuality(
    actor: AuthorizationContext,
    draft: ArticleDraft,
    brief: ArticleBrief,
  ): Promise<QualityGate> {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);
    const gate = evaluateQualityGate(draft, brief, {
      id: this.infra.ids.next(),
      evaluatedAt: this.infra.clock.now().toISOString(),
    });
    await this.qualityGates.add(gate);
    await emitAudit(
      this.infra,
      actor,
      gate,
      `quality_gate.${gate.status.toLowerCase()}`,
      "QualityGate",
      gate.id,
      gate.evaluatedAt,
    );
    return gate;
  }

  /**
   * Platform-wide floor every draft must clear regardless of vertical: it must
   * reference real source provider content and carry a non-blank title.
   */
  async evaluatePlatformGate(
    actor: AuthorizationContext,
    draft: ArticleDraft,
    industryProfile: IndustryProfile,
  ): Promise<PlatformGate> {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);
    const failureReasons: string[] = [];
    if (draft.sourceProviderArticleContentIds.length === 0) {
      failureReasons.push("Draft has no source provider content references.");
    }
    if (draft.title.trim().length === 0) {
      failureReasons.push("Draft title is blank.");
    }

    const id = this.infra.ids.next();
    const evaluatedAt = this.infra.clock.now().toISOString();
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
    await this.platformGates.add(gate);
    await emitAudit(
      this.infra,
      actor,
      gate,
      `platform_gate.${gate.status.toLowerCase()}`,
      "PlatformGate",
      gate.id,
      gate.evaluatedAt,
    );
    return gate;
  }

  /** Vertical-specific gate: the draft must have at least one section. */
  async evaluateVerticalGate(
    actor: AuthorizationContext,
    draft: ArticleDraft,
    industryProfile: IndustryProfile,
  ): Promise<VerticalGate> {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);
    const failureReasons: string[] = [];
    if (draft.sections.length === 0) {
      failureReasons.push("Draft has no sections to evaluate against vertical rules.");
    }

    const id = this.infra.ids.next();
    const evaluatedAt = this.infra.clock.now().toISOString();
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
    await this.verticalGates.add(gate);
    await emitAudit(
      this.infra,
      actor,
      gate,
      `vertical_gate.${gate.status.toLowerCase()}`,
      "VerticalGate",
      gate.id,
      gate.evaluatedAt,
    );
    return gate;
  }

  /**
   * Produces an ArticleApproval. Only callable with three PASSED gate results
   * (enforced at the type level) plus a real approverId. A FAILED/missing gate
   * cannot be passed here without a type error.
   */
  async approveArticle(
    actor: AuthorizationContext,
    draft: ArticleDraft,
    approverId: string,
    qualityGate: PassedQualityGate,
    platformGate: PassedPlatformGate,
    verticalGate: PassedVerticalGate,
  ): Promise<ArticleApproval> {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);

    if (approverId.trim().length === 0) {
      throw new Error("approveArticle: a real, non-empty approverId is required.");
    }
    for (const gate of [qualityGate, platformGate, verticalGate]) {
      if (gate.articleDraftId !== draft.id) {
        throw new Error(
          `approveArticle: gate "${gate.id}" evaluated draft "${gate.articleDraftId}", not "${draft.id}".`,
        );
      }
    }

    const approvedAt = this.infra.clock.now().toISOString();
    const approval: ArticleApproval = {
      id: this.infra.ids.next(),
      clientOrganizationId: draft.clientOrganizationId,
      projectId: draft.projectId,
      articleDraftId: draft.id,
      approverId,
      approvedAt,
      qualityGateId: qualityGate.id,
      qualityGateStatus: "PASSED",
      platformGateId: platformGate.id,
      platformGateStatus: "PASSED",
      verticalGateId: verticalGate.id,
      verticalGateStatus: "PASSED",
    };
    await this.approvals.add(approval);
    await emitAudit(
      this.infra,
      actor,
      approval,
      "article.approved",
      "ArticleApproval",
      approval.id,
      approvedAt,
    );
    return approval;
  }
}
