import { assertCanAccessClientOrganization } from "../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../contracts/tenancy/entities.js";
import type { OptionalKeywordSeed } from "./contracts.js";
import type {
  KnowledgeGroundingPort,
  OptionalKeywordEnhancementPort,
  KnowledgeOpportunityGeneratorPort,
  KnowledgeOpportunityUseCase,
} from "./ports.js";

export class KnowledgeFirstOpportunityService implements KnowledgeOpportunityUseCase {
  constructor(
    private readonly grounding: KnowledgeGroundingPort,
    private readonly generator: KnowledgeOpportunityGeneratorPort,
    private readonly keywordEnhancement?: OptionalKeywordEnhancementPort,
  ) {}

  async generateForProject(
    actor: AuthorizationContext,
    input: {
      readonly clientOrganizationId: string;
      readonly projectId: string;
      readonly knowledgePackageId: string;
      readonly optionalKeywordSeeds?: readonly OptionalKeywordSeed[];
    },
  ) {
    assertCanAccessClientOrganization(actor, input.clientOrganizationId);
    const snapshot = await this.grounding.load(input);
    if (!snapshot) throw new Error("knowledge package was not found for this project");
    if (
      snapshot.clientOrganizationId !== input.clientOrganizationId ||
      snapshot.projectId !== input.projectId ||
      snapshot.knowledgePackageId !== input.knowledgePackageId
    ) {
      throw new Error("knowledge grounding port returned a cross-tenant package");
    }
    const serverSeeds = this.keywordEnhancement
      ? await this.keywordEnhancement.load({
          clientOrganizationId: input.clientOrganizationId,
          projectId: input.projectId,
        })
      : input.optionalKeywordSeeds ?? [];
    return this.generator.generate({
      ...snapshot,
      optionalKeywordSeeds: serverSeeds,
    });
  }
}
