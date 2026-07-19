import type { AuthorizationContext } from "../../contracts/tenancy/entities.js";
import type {
  GenerateKnowledgeOpportunityInput,
  KnowledgeGroundingSnapshot,
  KnowledgeOpportunityBatch,
  OptionalKeywordSeed,
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

/** Server-owned, tenant-scoped enhancement input. Browser payloads never implement this port. */
export interface OptionalKeywordEnhancementPort {
  load(scope: {
    readonly clientOrganizationId: string;
    readonly projectId: string;
  }): Promise<readonly OptionalKeywordSeed[]>;
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
