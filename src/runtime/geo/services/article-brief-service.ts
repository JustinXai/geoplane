/**
 * ArticleBriefService — builds the planning brief from an OpportunityFamily
 * (chain item 8). Every authorizing HumanReviewDecision id from the family is
 * carried forward into the brief's planning context, so the brief is auditable
 * back to the human approvals that authorized it without re-joining the family.
 *
 * A brief is immutable once created (append-only repository, every field
 * required at construction); a revised brief is a new ArticleBrief with a new
 * id, never a mutation.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  ArticleBrief,
  ArticleBriefPlanningContextV1,
  OpportunityFamily,
} from "../../../contracts/geo-business/entities.js";
import type { ArticleBriefRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export interface CreateArticleBriefInput {
  readonly family: OpportunityFamily;
  readonly workingTitle: string;
  readonly outline: string[];
  readonly targetKeywords: [string, ...string[]];
  readonly riskLevel: ArticleBriefPlanningContextV1["riskLevel"];
}

export class ArticleBriefService {
  constructor(
    private readonly briefs: ArticleBriefRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async createBrief(
    actor: AuthorizationContext,
    input: CreateArticleBriefInput,
  ): Promise<ArticleBrief> {
    assertCanAccessClientOrganization(actor, input.family.clientOrganizationId);

    const authorizingHumanReviewDecisionIds = input.family.members.map(
      (member) => member.authorizingHumanReviewDecisionId,
    ) as [string, ...string[]];

    const createdAt = this.infra.clock.now().toISOString();
    const planningContext: ArticleBriefPlanningContextV1 = {
      schemaVersion: "ArticleBriefPlanningContextV1",
      opportunityFamilyId: input.family.id,
      authorizingHumanReviewDecisionIds,
      targetKeywords: input.targetKeywords,
      riskLevel: input.riskLevel,
    };
    const brief: ArticleBrief = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.family.clientOrganizationId,
      projectId: input.family.projectId,
      opportunityFamilyId: input.family.id,
      planningContext,
      workingTitle: input.workingTitle,
      outline: input.outline,
      createdAt,
    };
    await this.briefs.add(brief);
    await emitAudit(
      this.infra,
      actor,
      brief,
      "article_brief.created",
      "ArticleBrief",
      brief.id,
      createdAt,
    );
    return brief;
  }
}
