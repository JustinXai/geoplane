/**
 * Knowledge-first opportunity contracts.
 *
 * These contracts deliberately do not import the keyword runtime. Keyword data is an optional,
 * narrow seed/evidence input; enterprise knowledge remains sufficient to produce candidates.
 */

export type KnowledgeOpportunitySource =
  | "KNOWLEDGE_GROUNDED_OPPORTUNITY"
  | "INDUSTRY_HYPOTHESIS";

export type UserIntent = "LEARN" | "SOLVE" | "COMPARE" | "EVALUATE" | "DECIDE";

export type DecisionStage = "AWARENESS" | "CONSIDERATION" | "DECISION";

export interface KnowledgeBusinessContext {
  readonly enterpriseIntroduction: string;
  readonly productsAndServices: readonly string[];
  readonly cases: readonly string[];
  readonly faqs: readonly { readonly question: string; readonly answer?: string }[];
  readonly targetAudiences: readonly string[];
  readonly regions: readonly string[];
  readonly businessGoals: readonly string[];
  readonly differentiators: readonly string[];
  readonly forbiddenExpressions: readonly string[];
  readonly verifiableFacts: readonly string[];
  readonly industry?: string;
}

/**
 * A small compatibility seam for optional keyword inputs. `sourceRef` is opaque so this module
 * neither defines nor duplicates the generic Keyword Core owned by the keyword lane.
 */
export interface OptionalKeywordSeed {
  readonly text: string;
  readonly origin: "MANUAL" | "DATASET";
  readonly sourceRef?: string;
  readonly evidence?: readonly OptionalDemandEvidenceSeed[];
}

/** Evidence is accepted only when the upstream source explicitly marks it verified. */
export interface OptionalDemandEvidenceSeed {
  readonly field: string;
  readonly value: string | number;
  readonly sourceLabel: string;
  readonly observedAt?: string;
  readonly verified: true;
}

export interface KnowledgeGroundingSnapshot {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly knowledgePackageId: string;
  readonly knowledgePackageVersion: number;
  readonly context: KnowledgeBusinessContext;
}

export interface GenerateKnowledgeOpportunityInput extends KnowledgeGroundingSnapshot {
  readonly optionalKeywordSeeds?: readonly OptionalKeywordSeed[];
}

export interface UserQuestionCandidate {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly knowledgePackageId: string;
  readonly knowledgePackageVersion: number;
  readonly question: string;
  readonly intent: UserIntent;
  readonly scenario: string;
  readonly audience: string;
  readonly problem: string;
  readonly decisionStage: DecisionStage;
  readonly contentOpportunity: string;
  readonly evidenceNeed: readonly string[];
  readonly contentConstraints: readonly string[];
  readonly source: KnowledgeOpportunitySource;
  /** This candidate never asserts confirmed demand, even when a seed carries real evidence. */
  readonly demandClaim: "NOT_ASSERTED";
  readonly seed?: {
    readonly text: string;
    readonly origin: "MANUAL" | "DATASET";
    readonly sourceRef?: string;
    readonly verifiedEvidence: readonly OptionalDemandEvidenceSeed[];
  };
}

export interface KnowledgeOpportunityBatch {
  readonly knowledgePackageId: string;
  readonly knowledgePackageVersion: number;
  readonly candidates: readonly UserQuestionCandidate[];
}
