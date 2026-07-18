/**
 * HumanReviewService — the human-review gate (chain item 6). Per
 * SYSTEM_INVARIANTS_V1.md "no silently-approved state":
 *
 *  - There is NO default/auto path to an APPROVED decision. The only way to
 *    produce an APPROVED HumanReviewDecision is to call `confirm` with an
 *    explicit, non-empty reviewer identity.
 *  - Every one of the three methods requires a real `reviewerId` (guarded at
 *    runtime as non-empty) and produces exactly one of the three real
 *    HumanReviewDecision variants — never a bare boolean.
 *  - The repository is append-only: a recorded decision can never be mutated
 *    into a different status afterwards; a changed mind is a new decision.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  HumanReviewDecision,
  OpportunityValidation,
} from "../../../contracts/geo-business/entities.js";
import type { HumanReviewRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

function assertRealReviewer(reviewerId: string): void {
  if (reviewerId.trim().length === 0) {
    throw new Error(
      "HumanReviewService: a real, non-empty reviewerId is required — human review is never auto-approved.",
    );
  }
}

export class HumanReviewService {
  constructor(
    private readonly reviews: HumanReviewRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  /**
   * The ONLY path to an APPROVED HumanReviewDecision. Requires an explicit
   * reviewer — there is no overload, default, or flag that yields APPROVED
   * without one.
   */
  async confirm(
    actor: AuthorizationContext,
    validation: OpportunityValidation,
    reviewerId: string,
  ): Promise<HumanReviewDecision> {
    assertCanAccessClientOrganization(actor, validation.clientOrganizationId);
    assertRealReviewer(reviewerId);
    const decidedAt = this.infra.clock.now().toISOString();
    const decision: HumanReviewDecision = {
      id: this.infra.ids.next(),
      clientOrganizationId: validation.clientOrganizationId,
      projectId: validation.projectId,
      opportunityId: validation.opportunityId,
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
    return decision;
  }

  async requestChanges(
    actor: AuthorizationContext,
    validation: OpportunityValidation,
    reviewerId: string,
    requestedChangesNote: string,
  ): Promise<HumanReviewDecision> {
    assertCanAccessClientOrganization(actor, validation.clientOrganizationId);
    assertRealReviewer(reviewerId);
    const decidedAt = this.infra.clock.now().toISOString();
    const decision: HumanReviewDecision = {
      id: this.infra.ids.next(),
      clientOrganizationId: validation.clientOrganizationId,
      projectId: validation.projectId,
      opportunityId: validation.opportunityId,
      opportunityValidationId: validation.id,
      status: "CHANGES_REQUESTED",
      reviewerId,
      decidedAt,
      requestedChangesNote,
    };
    await this.reviews.add(decision);
    await emitAudit(
      this.infra,
      actor,
      decision,
      "human_review.changes_requested",
      "HumanReviewDecision",
      decision.id,
      decidedAt,
    );
    return decision;
  }

  async reject(
    actor: AuthorizationContext,
    validation: OpportunityValidation,
    reviewerId: string,
    rejectionReasonNote: string,
  ): Promise<HumanReviewDecision> {
    assertCanAccessClientOrganization(actor, validation.clientOrganizationId);
    assertRealReviewer(reviewerId);
    const decidedAt = this.infra.clock.now().toISOString();
    const decision: HumanReviewDecision = {
      id: this.infra.ids.next(),
      clientOrganizationId: validation.clientOrganizationId,
      projectId: validation.projectId,
      opportunityId: validation.opportunityId,
      opportunityValidationId: validation.id,
      status: "REJECTED",
      reviewerId,
      decidedAt,
      rejectionReasonNote,
    };
    await this.reviews.add(decision);
    await emitAudit(
      this.infra,
      actor,
      decision,
      "human_review.rejected",
      "HumanReviewDecision",
      decision.id,
      decidedAt,
    );
    return decision;
  }
}
