export type KeywordSource = "MANUAL" | "GENERIC_FILE" | "BAIDU_KEYWORD" | "CUSTOMER_HISTORY" | "OTHER_PROVIDER";
export type KeywordDecision = "CONFIRMED" | "CHANGES_REQUESTED" | "REJECTED";

export interface KeywordDatasetView {
  readonly id: string;
  readonly name: string;
  readonly source: KeywordSource;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly createdAt: string;
  readonly readOnly?: boolean;
}

export interface DemandEvidenceView {
  readonly id: string;
  readonly keywordRecordId: string;
  readonly source: KeywordSource;
  readonly metricKind: string;
  readonly metricValue: number;
  readonly metricUnit?: string;
  readonly region?: string;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly sourceReference: string;
  readonly observedAt: string;
}

export interface KeywordRecordView {
  readonly id: string;
  readonly datasetId: string;
  readonly importBatchId?: string;
  readonly keyword: string;
  readonly normalizedKeyword: string;
  readonly source: KeywordSource;
  readonly category?: string;
  readonly note?: string;
  readonly region?: string;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly createdAt: string;
}

export interface KeywordImportBatchView {
  readonly id: string;
  readonly datasetId: string;
  readonly fileName: string;
  readonly source: KeywordSource;
  readonly status: "COMPLETED" | "FAILED";
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly importedAt: string;
}

export interface KeywordReviewPackageView { readonly id:string; readonly datasetId:string; readonly version:number; readonly keywordRecordIds:readonly string[]; readonly status:"OPEN"|"COMPLETED"; readonly submittedAt:string }
export interface KeywordDecisionRecordView { readonly id:string; readonly reviewPackageId:string; readonly keywordRecordId:string; readonly decision:KeywordDecision; readonly note?:string; readonly decidedAt:string }

export interface GenericKeywordWorkspaceView {
  readonly projectId: string;
  readonly datasets: readonly KeywordDatasetView[];
  readonly records: readonly KeywordRecordView[];
  readonly imports: readonly KeywordImportBatchView[];
  readonly evidence: readonly DemandEvidenceView[];
  readonly reviewPackages: readonly KeywordReviewPackageView[];
  readonly decisions: readonly KeywordDecisionRecordView[];
  readonly capabilities: {
    readonly createDataset: boolean;
    readonly manualAdd: boolean;
    readonly genericCsvXlsxImport: boolean;
    readonly humanReview: boolean;
    readonly archive: boolean;
    readonly legacyBaiduReadOnly: boolean;
  };
}
