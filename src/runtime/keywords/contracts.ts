/** BAIDU_KEYWORD_RUNTIME_V1 — reconstructed P0 contract. */

export type KeywordImportFormat = "CSV" | "XLSX";
export type KeywordImportStatus = "PENDING" | "VALIDATED" | "COMPLETED" | "FAILED";
export type KeywordEvidenceStatus = "OBSERVED_DEMAND";
export type KeywordReviewDecision = "CONFIRMED" | "CHANGES_REQUESTED" | "REJECTED";

export interface KeywordScope {
  readonly clientOrganizationId: string;
  readonly projectId: string;
}

export interface KeywordReferenceSourceImport extends KeywordScope {
  readonly id: string;
  readonly sourceKind: "BAIDU_REFERENCE_EXPORT";
  readonly format: KeywordImportFormat;
  readonly sourceFileName: string;
  readonly sourceManifestHash: string;
  readonly status: KeywordImportStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly parsedCount: number;
  readonly rejectedCount: number;
}

export interface KeywordRawObservation extends KeywordScope {
  readonly id: string;
  readonly importId: string;
  readonly sourceLocator: string;
  readonly seedKeyword: string;
  readonly rawKeyword: string;
  readonly demandValue?: number;
  readonly observedAt: string;
  readonly rawRecordHash: string;
}

export interface KeywordNormalizedForm extends KeywordScope {
  readonly id: string;
  readonly rawObservationId: string;
  readonly normalizedKeyword: string;
  readonly normalizationRuleVersion: string;
  readonly createdAt: string;
}

export interface KeywordDiscovery extends KeywordScope {
  readonly id: string;
  readonly normalizedFormId: string;
  readonly seedKeyword: string;
  readonly method: "IMPORTED_SEED_EXPANSION";
  readonly discoveredAt: string;
}

export interface KeywordDemandObservation extends KeywordScope {
  readonly id: string;
  readonly normalizedFormId: string;
  readonly rawObservationId: string;
  readonly status: KeywordEvidenceStatus;
  readonly metricKind: "BAIDU_DEMAND_INDEX";
  readonly metricValue: number;
  readonly observedAt: string;
}

export interface KeywordReferenceSnapshot extends KeywordScope {
  readonly id: string;
  readonly importId: string;
  readonly snapshotVersion: number;
  readonly manifestHash: string;
  readonly rawObservationCount: number;
  readonly normalizedFormCount: number;
  readonly demandObservationCount: number;
  readonly sealedAt: string;
}

export interface KeywordFamilyDraft extends KeywordScope {
  readonly id: string;
  readonly snapshotId: string;
  readonly version: number;
  readonly label: string;
  readonly normalizedFormIds: readonly string[];
  readonly rationale: string;
  readonly status: "DRAFT" | "SUBMITTED";
  readonly createdByUserId: string;
  readonly createdAt: string;
}

export interface HumanReviewPackage extends KeywordScope {
  readonly id: string;
  readonly snapshotId: string;
  readonly packageVersion: number;
  readonly familyDraftIds: readonly string[];
  readonly status: "OPEN" | "IN_REVIEW" | "COMPLETED";
  readonly submittedByUserId: string;
  readonly submittedAt: string;
}

export interface KeywordReviewRecord extends KeywordScope {
  readonly id: string;
  readonly reviewPackageId: string;
  readonly familyDraftId: string;
  readonly decision: KeywordReviewDecision;
  readonly reviewerUserId: string;
  readonly decidedAt: string;
  readonly note?: string;
}

export interface KeywordImportRow {
  readonly sourceRow: number;
  readonly seedKeyword: string;
  readonly keyword: string;
  readonly demandValue?: number;
  readonly observedAt?: string;
}

export interface KeywordRejectedRow {
  readonly sourceRow: number;
  readonly code: "MISSING_SEED" | "MISSING_KEYWORD" | "INVALID_DEMAND" | "INVALID_DATE";
}

export interface KeywordParsedFile {
  readonly format: KeywordImportFormat;
  readonly sourceHash: string;
  readonly rows: readonly KeywordImportRow[];
  readonly rejected: readonly KeywordRejectedRow[];
}
