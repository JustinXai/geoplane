/** GENERIC_KEYWORD_CORE_V1 — source-neutral keyword data and human review contracts. */

export type KeywordSource = "MANUAL" | "GENERIC_FILE" | "BAIDU_KEYWORD" | "CUSTOMER_HISTORY" | "OTHER_PROVIDER";
export type KeywordDatasetStatus = "ACTIVE" | "ARCHIVED";
export type KeywordImportFormat = "CSV" | "XLSX";
export type KeywordImportStatus = "COMPLETED" | "FAILED";
export type KeywordDecision = "CONFIRMED" | "CHANGES_REQUESTED" | "REJECTED";

export interface KeywordScope { readonly clientOrganizationId:string; readonly projectId:string }

export interface KeywordDataset extends KeywordScope {
  readonly id:string; readonly name:string; readonly source:KeywordSource;
  readonly status:KeywordDatasetStatus; readonly createdByUserId:string; readonly createdAt:string;
}

export interface KeywordImportBatch extends KeywordScope {
  readonly id:string; readonly datasetId:string; readonly source:KeywordSource;
  readonly format:KeywordImportFormat; readonly fileName:string; readonly manifestHash:string;
  readonly status:KeywordImportStatus; readonly acceptedCount:number; readonly rejectedCount:number;
  readonly importedByUserId:string; readonly importedAt:string;
}

export interface KeywordRecord extends KeywordScope {
  readonly id:string; readonly datasetId:string; readonly importBatchId?:string;
  readonly keyword:string; readonly normalizedKeyword:string; readonly source:KeywordSource;
  readonly category?:string; readonly note?:string; readonly region?:string;
  readonly periodStart?:string; readonly periodEnd?:string;
  readonly createdByUserId:string; readonly createdAt:string;
}

/** Evidence is deliberately separate: a KeywordRecord never implies confirmed demand. */
export interface DemandEvidence extends KeywordScope {
  readonly id:string; readonly keywordRecordId:string; readonly source:KeywordSource;
  readonly metricKind:string; readonly metricValue:number; readonly metricUnit?:string;
  readonly region?:string; readonly periodStart?:string; readonly periodEnd?:string;
  readonly sourceReference:string; readonly observedAt:string; readonly recordedAt:string;
}

export interface KeywordReviewPackage extends KeywordScope {
  readonly id:string; readonly datasetId:string; readonly version:number;
  readonly keywordRecordIds:readonly string[]; readonly status:"OPEN"|"COMPLETED";
  readonly submittedByUserId:string; readonly submittedAt:string;
}

export interface KeywordDecisionRecord extends KeywordScope {
  readonly id:string; readonly reviewPackageId:string; readonly keywordRecordId:string;
  readonly decision:KeywordDecision; readonly reviewerUserId:string; readonly note?:string; readonly decidedAt:string;
}

export interface GenericKeywordImportRow {
  readonly sourceRow:number; readonly keyword:string; readonly category?:string; readonly note?:string;
  readonly region?:string; readonly periodStart?:string; readonly periodEnd?:string;
  readonly metricKind?:string; readonly metricValue?:number; readonly metricUnit?:string;
  readonly observedAt?:string; readonly sourceReference?:string;
}

export interface GenericKeywordParsedFile {
  readonly format:KeywordImportFormat; readonly sourceHash:string;
  readonly rows:readonly GenericKeywordImportRow[];
  readonly rejected:readonly {readonly sourceRow:number;readonly code:string}[];
}
