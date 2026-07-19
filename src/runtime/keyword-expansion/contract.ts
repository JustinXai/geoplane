/**
 * Classification: RECOVERED_SPECIFIED_NOT_COMPLETED.
 * Current contract reconstructed from the accepted recovery target; this file
 * is not evidence that the deleted implementation was recovered.
 */
export const EXPANSION_GROUP_TYPES = [
  "PREFIX", "MAIN", "SUFFIX", "RECOMMENDATION", "QUESTION", "REGION",
] as const;
export type ExpansionGroupType = (typeof EXPANSION_GROUP_TYPES)[number];
export type ExpansionReviewStatus = "NEEDS_HUMAN_REVIEW" | "CONFIRMED" | "DELETED";

export interface ExpansionGroupInput {
  readonly type: ExpansionGroupType;
  readonly values: readonly string[];
}

export interface KeywordExpansionRequest {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly groups: readonly ExpansionGroupInput[];
  readonly requestedByUserId: string;
  readonly reason: string;
}

export interface ExpansionInputSnapshot {
  readonly groups: readonly ExpansionGroupInput[];
  readonly reason: string;
}

export interface ExpansionProvenance {
  readonly generator: "DETERMINISTIC_OFFLINE";
  readonly generatorVersion: string;
  readonly generatedAt: string;
  readonly requestedByUserId: string;
  readonly inputSnapshot: ExpansionInputSnapshot;
}

export interface KeywordExpansionCandidate {
  readonly id: string;
  readonly batchId: string;
  readonly keyword: string;
  readonly question: string | null;
  readonly reason: string;
  /** Explanatory generation confidence only; never search demand or ranking. */
  readonly confidence: number;
  readonly status: ExpansionReviewStatus;
  readonly provenance: ExpansionProvenance;
}

export interface KeywordExpansionBatch {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly version: number;
  readonly status: "PREVIEW";
  readonly candidates: readonly KeywordExpansionCandidate[];
  readonly createdAt: string;
}

/** Demand facts are deliberately absent from the public expansion contract. */
export const FORBIDDEN_EXPANSION_DEMAND_FIELDS = [
  "searchVolume", "bid", "competition", "trend", "traffic", "ranking", "demandStatus",
] as const;
