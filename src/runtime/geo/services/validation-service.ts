/**
 * ValidationService — records the outcome of validating an Opportunity against
 * an IndustryProfile (chain item 5). The gate level actually applied is
 * captured point-in-time on the validation record for auditability, exactly
 * as the frozen OpportunityValidation contract prescribes.
 *
 * Note: a VALIDATED (or REJECTED) OpportunityValidation is NOT an approval.
 * Approval is a separate human-review step (HumanReviewService) — this service
 * can never produce an approved/publishable state on its own.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  IndustryProfile,
  Opportunity,
  OpportunityValidation,
  OpportunityValidationStatus,
} from "../../../contracts/geo-business/entities.js";
import type { OpportunityValidationRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export interface ValidateOpportunityInput {
  readonly opportunity: Opportunity;
  readonly industryProfile: IndustryProfile;
  /** Only VALIDATED or REJECTED are valid outcomes of an automated validation step. */
  readonly status: Extract<OpportunityValidationStatus, "VALIDATED" | "REJECTED">;
  readonly reasonNote: string;
}

export class ValidationService {
  constructor(
    private readonly validations: OpportunityValidationRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async validateOpportunity(
    actor: AuthorizationContext,
    input: ValidateOpportunityInput,
  ): Promise<OpportunityValidation> {
    assertCanAccessClientOrganization(actor, input.opportunity.clientOrganizationId);

    if (
      input.opportunity.clientOrganizationId !== input.industryProfile.clientOrganizationId ||
      input.opportunity.projectId !== input.industryProfile.projectId
    ) {
      throw new Error(
        "validateOpportunity: Opportunity and IndustryProfile belong to different tenants.",
      );
    }

    const validatedAt = this.infra.clock.now().toISOString();
    const validation: OpportunityValidation = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.opportunity.clientOrganizationId,
      projectId: input.opportunity.projectId,
      opportunityId: input.opportunity.id,
      status: input.status,
      industryProfileId: input.industryProfile.id,
      // Point-in-time record of the gate level actually applied.
      gateLevelApplied: input.industryProfile.validationGateLevel,
      reasonNote: input.reasonNote,
      validatedAt,
    };
    await this.validations.add(validation);
    await emitAudit(
      this.infra,
      actor,
      validation,
      "opportunity.validated",
      "OpportunityValidation",
      validation.id,
      validatedAt,
    );
    return validation;
  }
}
