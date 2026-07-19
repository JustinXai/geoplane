import { defaultApiClient, type ApiClient, type Result } from "../http.js";
import type { GenericKeywordWorkspaceView, KeywordDecision, KeywordRecordView, KeywordReviewPackageView } from "./contracts.js";

const enc = encodeURIComponent;

export interface GenericKeywordApi {
  loadWorkspace(projectId: string): Promise<Result<GenericKeywordWorkspaceView>>;
  createDataset(input: { projectId: string; name: string; source: "MANUAL" | "GENERIC_FILE" | "BAIDU_KEYWORD" | "CUSTOMER_HISTORY" | "OTHER_PROVIDER" }): Promise<Result<unknown>>;
  addManualKeyword(input: { projectId: string; datasetId: string; keyword: string; category?: string; note?: string }): Promise<Result<KeywordRecordView>>;
  importFile(input: { projectId: string; datasetId: string; source: "GENERIC_FILE" | "BAIDU_KEYWORD"; fileName: string; base64: string }): Promise<Result<unknown>>;
  createReviewPackage(input: { projectId: string; datasetId: string; keywordRecordIds: readonly string[]; version: number }): Promise<Result<KeywordReviewPackageView>>;
  decide(input: { projectId: string; reviewPackageId: string; keywordRecordId: string; decision: KeywordDecision; note?: string }): Promise<Result<unknown>>;
  archiveDataset(input: { projectId: string; datasetId: string }): Promise<Result<unknown>>;
}

export function createGenericKeywordApi(client: ApiClient = defaultApiClient): GenericKeywordApi {
  return {
    loadWorkspace: (projectId) => client.request(`/api/generic-keywords/projects/${enc(projectId)}`),
    createDataset: (input) => client.request("/api/generic-keywords/datasets", { method: "POST", body: input }),
    addManualKeyword: (input) => client.request(`/api/generic-keywords/datasets/${enc(input.datasetId)}/records`, { method: "POST", body: input }),
    importFile: (input) => client.request("/api/generic-keywords/imports", { method: "POST", body: input }),
    createReviewPackage: (input) => client.request("/api/generic-keywords/review-packages", { method: "POST", body: input }),
    decide: (input) => client.request(`/api/generic-keywords/review-packages/${enc(input.reviewPackageId)}/decisions`, { method: "POST", body: input }),
    archiveDataset: (input) => client.request(`/api/generic-keywords/datasets/${enc(input.datasetId)}/archive`, { method: "POST", body: { projectId: input.projectId } }),
  };
}

export type { GenericKeywordWorkspaceView, KeywordDatasetView, KeywordRecordView, DemandEvidenceView, KeywordSource } from "./contracts.js";
