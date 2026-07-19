/** P0 domestic-GEO routes. All actions persist through existing services/routes. */
import type { PlatformAccount } from "../../runtime/accounts/entities.js";
import type { AgencyPortfolioSummary, AgencyWorkflowStage, AgencyWorkflowStatus } from "../../runtime/agency-delivery/contracts.js";
import type { KeywordExpansionBatch, KeywordExpansionCandidate, KeywordExpansionRequest } from "../../runtime/keyword-expansion/contract.js";
import type { ManualProbeSampleInput, RawProbeResult } from "../../runtime/probes/manual-sample.js";
import type { KnowledgeIssueViewV1,KnowledgePackageViewV1 } from "../../runtime/api-contracts/index.js";
import type { AccountCenterReadModel, BaiduKeywordReadModel, ManualProbeEntryOptions, PolicyPackReadModel } from "../../runtime/read-models/domestic-workspaces.js";
import { type ApiClient, defaultApiClient, type Result } from "./http.js";

const enc = encodeURIComponent;

export function loadKnowledgePackage(packageId:string,client:ApiClient=defaultApiClient):Promise<Result<KnowledgePackageViewV1>>{return client.request<KnowledgePackageViewV1>(`/api/knowledge/packages/${enc(packageId)}`)}
export function loadKnowledgeIssues(packageId:string,client:ApiClient=defaultApiClient):Promise<Result<readonly KnowledgeIssueViewV1[]>>{return client.request<readonly KnowledgeIssueViewV1[]>(`/api/knowledge/packages/${enc(packageId)}/issues`)}

export function getAccountCenter(client: ApiClient = defaultApiClient): Promise<Result<AccountCenterReadModel>> {
  return client.request<AccountCenterReadModel>("/api/accounts");
}
export function registerAccount(input: Pick<PlatformAccount, "platformCode" | "accountType" | "ownership" | "displayLabel"> & Partial<Pick<PlatformAccount, "agencyOrganizationId" | "clientOrganizationId">>, client: ApiClient = defaultApiClient) {
  return client.request<Omit<PlatformAccount, "secretReference">>("/api/accounts", { method: "POST", body: { action: "REGISTER", ...input } });
}
export function authorizeAccount(accountId: string, scope: { clientOrganizationId?: string; agencyOrganizationId?: string } = {}, client: ApiClient = defaultApiClient) {
  return client.request("/api/accounts", { method: "POST", body: { action: "AUTHORIZE", accountId, ...scope } });
}
export function getBaiduKeywordOverview(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<BaiduKeywordReadModel>> {
  return client.request<BaiduKeywordReadModel>(`/api/keywords/projects/${enc(projectId)}/overview`);
}
export interface KeywordImportResult { readonly status: "CREATED" | "ALREADY_IMPORTED"; readonly importId: string; readonly snapshotId: string; readonly parsedCount: number; readonly rejectedCount: number; readonly duplicateRecordCount: number }
export function importBaiduKeywords(input: { projectId: string; fileName: string; base64: string; snapshotVersion: number }, client: ApiClient = defaultApiClient): Promise<Result<KeywordImportResult>> {
  return client.request<KeywordImportResult>("/api/keywords/imports", { method: "POST", body: input });
}
export function getKeywordExpansions(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<readonly KeywordExpansionBatch[]>> {
  return client.request<readonly KeywordExpansionBatch[]>(`/api/keyword-expansion/projects/${enc(projectId)}`);
}
export function previewKeywordExpansion(input: Omit<KeywordExpansionRequest, "clientOrganizationId" | "requestedByUserId">, client: ApiClient = defaultApiClient): Promise<Result<KeywordExpansionBatch>> {
  return client.request<KeywordExpansionBatch>("/api/keyword-expansion/preview", { method: "POST", body: input });
}
export function reviewKeywordExpansion(candidateId: string, decision: "CONFIRMED" | "DELETED", reason: string, client: ApiClient = defaultApiClient): Promise<Result<KeywordExpansionCandidate>> {
  const action = decision === "CONFIRMED" ? "confirm" : "delete";
  return client.request<KeywordExpansionCandidate>(`/api/keyword-expansion/candidates/${enc(candidateId)}/${action}`, { method: "POST", body: { reason } });
}
export function listManualProbeSamples(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<readonly RawProbeResult[]>> {
  return client.request<readonly RawProbeResult[]>(`/api/probes/projects/${enc(projectId)}/manual-samples`);
}
export function getManualProbeEntryOptions(client:ApiClient=defaultApiClient):Promise<Result<ManualProbeEntryOptions>>{return client.request<ManualProbeEntryOptions>("/api/probes/options")}
export function recordManualProbeSample(input: Omit<ManualProbeSampleInput, "clientOrganizationId">, client: ApiClient = defaultApiClient): Promise<Result<RawProbeResult>> {
  return client.request<RawProbeResult>("/api/probes/manual-samples", { method: "POST", body: input });
}
export function getPolicyPack(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<PolicyPackReadModel>> {
  return client.request<PolicyPackReadModel>(`/api/policy-packs/projects/${enc(projectId)}`);
}
export function getAgencyDeliveryPortfolio(agencyOrganizationId: string, client: ApiClient = defaultApiClient): Promise<Result<AgencyPortfolioSummary>> {
  return client.request<AgencyPortfolioSummary>(`/api/agency-delivery/portfolio?agencyOrganizationId=${enc(agencyOrganizationId)}`);
}
export function moveAgencyWorkflow(input: { agencyOrganizationId: string; clientOrganizationId: string; projectId: string; stage: AgencyWorkflowStage; toStatus: AgencyWorkflowStatus; reason: string }, client: ApiClient = defaultApiClient) {
  return client.request("/api/agency-delivery/workflow", { method: "POST", body: input });
}
export function registerAgencyDelivery(input: { agencyOrganizationId: string; clientOrganizationId: string; projectId: string; action: "MARK_READY" | "REGISTER_DELIVERED"; receiptReference?: string }, client: ApiClient = defaultApiClient) {
  return client.request("/api/agency-delivery/deliveries", { method: "POST", body: input });
}
