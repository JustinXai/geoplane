import type { AuthorizationContext } from "../../contracts/tenancy/entities.js";
import type {
  GenerateKnowledgeOpportunityInput,
  KnowledgeGroundingSnapshot,
  KnowledgeOpportunityBatch,
} from "./contracts.js";

export interface KnowledgeGroundingPort {
  load(scope: {
    readonly clientOrganizationId: string;
    readonly projectId: string;
    readonly knowledgePackageId: string;
  }): Promise<KnowledgeGroundingSnapshot | null>;
}

export interface KnowledgeOpportunityGeneratorPort {
  generate(input: GenerateKnowledgeOpportunityInput): KnowledgeOpportunityBatch;
}

export interface KnowledgeOpportunityUseCase {
  generateForProject(
    actor: AuthorizationContext,
    input: {
      readonly clientOrganizationId: string;
      readonly projectId: string;
      readonly knowledgePackageId: string;
      readonly optionalKeywordSeeds?: GenerateKnowledgeOpportunityInput["optionalKeywordSeeds"];
    },
  ): Promise<KnowledgeOpportunityBatch>;
}
