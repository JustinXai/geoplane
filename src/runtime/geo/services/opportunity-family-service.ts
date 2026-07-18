/**
 * OpportunityFamilyService — groups one or more APPROVED Opportunities into
 * the unit that becomes a single piece of content (chain item 7).
 *
 * Two layers guarantee "no Opportunity enters a family without an APPROVED
 * human-review decision":
 *
 *  1. STRUCTURAL: `OpportunityFamilyMember.authorizingReviewDecisionStatus` is
 *     pinned to the literal `"APPROVED"` in the frozen contract, so a member
 *     built from a CHANGES_REQUESTED/REJECTED decision does not type-check.
 *  2. RUNTIME (this service): every member's authorizing decision id is looked
 *     up in the append-only HumanReviewRepository and re-verified to actually
 *     exist, belong to this tenant, and have status APPROVED — catching the
 *     boundary case of a forged member literal arriving from outside static
 *     typing (e.g. deserialized JSON).
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type { OpportunityFamily } from "../../../contracts/geo-business/entities.js";
import type { HumanReviewRepository, OpportunityFamilyRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export interface CreateOpportunityFamilyInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly members: OpportunityFamily["members"];
}

export class OpportunityFamilyService {
  constructor(
    private readonly families: OpportunityFamilyRepository,
    private readonly reviews: HumanReviewRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async createFamily(
    actor: AuthorizationContext,
    input: CreateOpportunityFamilyInput,
  ): Promise<OpportunityFamily> {
    assertCanAccessClientOrganization(actor, input.clientOrganizationId);

    for (const member of input.members) {
      const decision = await this.reviews.getById(member.authorizingHumanReviewDecisionId);
      if (decision === undefined) {
        throw new Error(
          `createFamily: authorizing HumanReviewDecision "${member.authorizingHumanReviewDecisionId}" ` +
            `does not exist — an Opportunity may not enter a family without a real approval.`,
        );
      }
      if (
        decision.clientOrganizationId !== input.clientOrganizationId ||
        decision.projectId !== input.projectId
      ) {
        throw new Error(
          `createFamily: authorizing HumanReviewDecision "${decision.id}" belongs to a different tenant.`,
        );
      }
      if (decision.status !== "APPROVED") {
        throw new Error(
          `createFamily: authorizing HumanReviewDecision "${decision.id}" has status ` +
            `"${decision.status}", not "APPROVED" — human review is never auto-approved.`,
        );
      }
      if (decision.opportunityId !== member.opportunityId) {
        throw new Error(
          `createFamily: HumanReviewDecision "${decision.id}" authorizes opportunity ` +
            `"${decision.opportunityId}", not member opportunity "${member.opportunityId}".`,
        );
      }
    }

    const createdAt = this.infra.clock.now().toISOString();
    const family: OpportunityFamily = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      members: input.members,
      createdAt,
    };
    await this.families.add(family);
    await emitAudit(
      this.infra,
      actor,
      family,
      "opportunity_family.created",
      "OpportunityFamily",
      family.id,
      createdAt,
    );
    return family;
  }
}
