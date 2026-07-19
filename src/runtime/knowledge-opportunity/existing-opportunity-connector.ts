import type { AuthorizationContext } from "../../contracts/tenancy/entities.js";
import type { KnowledgePackage, Opportunity, KeywordQuestionMap } from "../../contracts/geo-business/entities.js";
import type { KeywordQuestionService } from "../geo/services/keyword-question-service.js";
import type { OpportunityService } from "../geo/services/opportunity-service.js";
import type { UserQuestionCandidate } from "./contracts.js";

/**
 * Compatibility connector for the frozen 0003 schema, where Opportunity still requires a
 * KeywordQuestionMap FK. It delegates both writes to the existing domain services. When there is
 * no keyword seed, the internal map uses the content-opportunity label solely as a schema anchor;
 * it is not exposed as confirmed demand and carries no demand metric.
 */
export class ExistingOpportunityConnector {
  constructor(
    private readonly keywordQuestions: Pick<KeywordQuestionService, "createKeywordQuestionMap">,
    private readonly opportunities: Pick<OpportunityService, "createOpportunity">,
  ) {}

  async create(
    actor: AuthorizationContext,
    input: {
      readonly candidate: UserQuestionCandidate;
      readonly knowledgePackage: KnowledgePackage;
      readonly industryProfileId: string;
    },
  ): Promise<{ readonly keywordQuestionMap: KeywordQuestionMap; readonly opportunity: Opportunity }> {
    const { candidate, knowledgePackage } = input;
    if (
      candidate.clientOrganizationId !== knowledgePackage.clientOrganizationId ||
      candidate.projectId !== knowledgePackage.projectId ||
      candidate.knowledgePackageId !== knowledgePackage.id ||
      candidate.knowledgePackageVersion !== knowledgePackage.version
    ) {
      throw new Error("candidate and grounding knowledge package do not match");
    }
    if (candidate.demandClaim !== "NOT_ASSERTED") {
      throw new Error("knowledge-first candidates must not assert confirmed demand");
    }
    const compatibilityKeyword = candidate.seed?.text ?? candidate.contentOpportunity;
    const keywordQuestionMap = await this.keywordQuestions.createKeywordQuestionMap(actor, {
      knowledgePackage,
      industryProfileId: input.industryProfileId,
      entries: [{ keyword: compatibilityKeyword, questions: [candidate.question] }],
    });
    const opportunity = await this.opportunities.createOpportunity(actor, {
      keywordQuestionMap,
      keyword: compatibilityKeyword,
      knowledgePackage,
    });
    return { keywordQuestionMap, opportunity };
  }
}
