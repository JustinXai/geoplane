/**
 * DraftReviewService — Human review decisions for ArticleDrafts.
 *
 * Per SYSTEM_INVARIANTS_V1.md "no silently-approved state":
 *
 *  - There is NO default/auto path to an APPROVED decision. The only way to
 *    produce an APPROVED decision is via explicit human review with a real reviewer identity.
 *  - Every one of the three methods requires a real reviewer identity (guarded at
 *    runtime as non-empty) and produces exactly one of the three real decision variants.
 *  - The repository is append-only: a recorded decision can never be mutated
 *    into a different status afterwards; a changed mind is a new decision.
 *
 * Supported decisions:
 *  - APPROVED → Publication Package created
 *  - RETURNED → Draft sent back for repair
 *  - REJECTED → Draft rejected, no publication
 *
 * This service reuses the existing HumanReviewDecision entity with the same
 * discriminated union structure, but for ArticleDraft reviews instead of Opportunity reviews.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  ArticleDraft,
  DraftArticleDraft,
  HumanReviewDecision,
} from "../../../contracts/geo-business/entities.js";
import type { HumanReviewRepository, ArticleDraftRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

/** Decision status for draft reviews. */
export type DraftReviewDecisionStatus = "APPROVED" | "RETURNED" | "REJECTED";

/** Input for a draft review decision. */
export interface DraftReviewDecisionInput {
  articleDraftId: string;
  decision: DraftReviewDecisionStatus;
  reviewerId: string;
  note?: string;
}

/** Result of a draft review decision. */
export interface DraftReviewDecisionResult {
  decision: HumanReviewDecision;
  /** The draft that was reviewed. */
  draft: ArticleDraft;
  /** For APPROVED: the created publish package id, if any. */
  publishPackageId?: string;
}

function assertRealReviewer(reviewerId: string): void {
  if (reviewerId.trim().length === 0) {
    throw new Error(
      "DraftReviewService: a real, non-empty reviewerId is required — human review is never auto-approved.",
    );
  }
}

export class DraftReviewService {
  constructor(
    private readonly reviews: HumanReviewRepository,
    private readonly drafts: ArticleDraftRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  /**
   * Records a human review decision for an ArticleDraft.
   *
   * @param actor - Authorization context for tenant isolation.
   * @param draft - The draft being reviewed.
   * @param input - The review decision input.
   * @returns DraftReviewDecisionResult with the decision and draft.
   *
   * @throws if reviewerId is empty (human review requires a real reviewer).
   * @throws if draft is not in DRAFT status.
   */
  async decide(
    actor: AuthorizationContext,
    draft: ArticleDraft,
    input: DraftReviewDecisionInput,
  ): Promise<DraftReviewDecisionResult> {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);
    assertRealReviewer(input.reviewerId);

    if (draft.status !== "DRAFT") {
      throw new Error(
        `DraftReviewService: cannot review draft "${draft.id}" with status "${draft.status}" — only DRAFT drafts may be reviewed.`,
      );
    }

    const decidedAt = this.infra.clock.now().toISOString();

    // Build the HumanReviewDecision with the appropriate status
    // Note: we store the draft id in the opportunityId field for compatibility
    const decision: HumanReviewDecision = this.buildDecision(draft, input, decidedAt);

    await this.reviews.add(decision);
    await emitAudit(
      this.infra,
      actor,
      decision,
      `draft_review.${input.decision.toLowerCase()}`,
      "HumanReviewDecision",
      decision.id,
      decidedAt,
    );

    return {
      decision,
      draft,
    };
  }

  private buildDecision(
    draft: ArticleDraft,
    input: DraftReviewDecisionInput,
    decidedAt: string,
  ): HumanReviewDecision {
    const base = {
      id: this.infra.ids.next(),
      clientOrganizationId: draft.clientOrganizationId,
      projectId: draft.projectId,
      // Store draft id in opportunityId for compatibility with existing HumanReviewDecision
      opportunityId: draft.id,
      // Store the draft review type as the validation id
      opportunityValidationId: `draft-review:${draft.id}`,
      reviewerId: input.reviewerId,
      decidedAt,
    };

    switch (input.decision) {
      case "APPROVED":
        return {
          ...base,
          status: "APPROVED",
        };

      case "RETURNED":
        return {
          ...base,
          status: "CHANGES_REQUESTED",
          requestedChangesNote: input.note || "Draft returned for revision.",
        };

      case "REJECTED":
        return {
          ...base,
          status: "REJECTED",
          rejectionReasonNote: input.note || "Draft rejected.",
        };

      default:
        throw new Error(`DraftReviewService: unknown decision "${(input as any).decision}"`);
    }
  }
}
