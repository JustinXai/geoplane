/**
 * DistributionPlanService — records the explicit, human-chosen set of channels
 * to distribute a ChannelNeutralContentPackage to (chain item 13).
 *
 * "Ready to distribute with zero explicit human action" is impossible to
 * construct: `channelIds` is a non-empty tuple (calling with an empty array
 * does not type-check), and both `selectedByActorId` and `selectedAt` are
 * required — so a plan always records which human explicitly chose the
 * channels and when. There is no automatic default channel.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  ChannelNeutralContentPackage,
  DistributionPlan,
} from "../../../contracts/geo-business/entities.js";
import type { DistributionPlanRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export interface CreateDistributionPlanInput {
  readonly channelNeutralPackage: ChannelNeutralContentPackage;
  /** Non-empty: the human selection must already have happened. */
  readonly channelIds: [string, ...string[]];
  readonly selectedByActorId: string;
}

export class DistributionPlanService {
  constructor(
    private readonly plans: DistributionPlanRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async createDistributionPlan(
    actor: AuthorizationContext,
    input: CreateDistributionPlanInput,
  ): Promise<DistributionPlan> {
    assertCanAccessClientOrganization(actor, input.channelNeutralPackage.clientOrganizationId);

    if (input.selectedByActorId.trim().length === 0) {
      throw new Error(
        "createDistributionPlan: a real, non-empty selectedByActorId is required — channels are never auto-selected.",
      );
    }

    const selectedAt = this.infra.clock.now().toISOString();
    const plan: DistributionPlan = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.channelNeutralPackage.clientOrganizationId,
      projectId: input.channelNeutralPackage.projectId,
      channelNeutralContentPackageId: input.channelNeutralPackage.id,
      channelIds: input.channelIds,
      selectedByActorId: input.selectedByActorId,
      selectedAt,
    };
    await this.plans.add(plan);
    await emitAudit(
      this.infra,
      actor,
      plan,
      "distribution_plan.created",
      "DistributionPlan",
      plan.id,
      selectedAt,
    );
    return plan;
  }
}
