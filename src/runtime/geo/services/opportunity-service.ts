/**
 * OpportunityService — derives a candidate Opportunity from one
 * KeywordQuestionMap entry (chain item 4). Every Opportunity is required to
 * trace back to the specific KnowledgePackage id + version it is grounded in;
 * grounding is non-optional per the frozen contract, so there is no path here
 * to an ungrounded opportunity.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  KeywordQuestionMap,
  KnowledgePackage,
  Opportunity,
} from "../../../contracts/geo-business/entities.js";
import type { OpportunityRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export interface CreateOpportunityInput {
  readonly keywordQuestionMap: KeywordQuestionMap;
  readonly keyword: string;
  readonly knowledgePackage: KnowledgePackage;
}

export class OpportunityService {
  constructor(
    private readonly opportunities: OpportunityRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async createOpportunity(
    actor: AuthorizationContext,
    input: CreateOpportunityInput,
  ): Promise<Opportunity> {
    assertCanAccessClientOrganization(actor, input.knowledgePackage.clientOrganizationId);

    // The keyword must genuinely be one this map covers — an opportunity may
    // never be grounded in a keyword the sourcing map does not contain.
    const known = input.keywordQuestionMap.entries.some((entry) => entry.keyword === input.keyword);
    if (!known) {
      throw new Error(
        `createOpportunity: keyword "${input.keyword}" is not present in KeywordQuestionMap ` +
          `"${input.keywordQuestionMap.id}".`,
      );
    }

    // The map and the grounding package must belong to the same tenant.
    if (
      input.keywordQuestionMap.clientOrganizationId !== input.knowledgePackage.clientOrganizationId ||
      input.keywordQuestionMap.projectId !== input.knowledgePackage.projectId
    ) {
      throw new Error(
        "createOpportunity: KeywordQuestionMap and grounding KnowledgePackage belong to different tenants.",
      );
    }

    const createdAt = this.infra.clock.now().toISOString();
    const opportunity: Opportunity = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.knowledgePackage.clientOrganizationId,
      projectId: input.knowledgePackage.projectId,
      keywordQuestionMapId: input.keywordQuestionMap.id,
      keyword: input.keyword,
      groundingKnowledgePackageId: input.knowledgePackage.id,
      groundingKnowledgePackageVersion: input.knowledgePackage.version,
      createdAt,
    };
    await this.opportunities.add(opportunity);
    await emitAudit(
      this.infra,
      actor,
      opportunity,
      "opportunity.created",
      "Opportunity",
      opportunity.id,
      createdAt,
    );
    return opportunity;
  }
}
