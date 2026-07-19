/** Typed wrappers for routes that exist in the local P0 runtime. */
import type {
  AccountViewV1,
  AgencyClientPortfolioViewV1,
  ArticleDeliveryViewV1,
  AuditEventViewV1,
  KeywordQuestionViewV1,
  KnowledgeIssueViewV1,
  KnowledgePackageViewV1,
  OpportunityViewV1,
  ProjectViewV1,
} from "../../runtime/api-contracts/index.js";
import type { OrganizationSummaryV1 } from "../../runtime/commands/dto.js";
import type { HumanReviewDecisionViewV1 } from "../../runtime/commands/geo-dto.js";
import type { AgencyActingContextV1 } from "../../runtime/auth/auth-service.js";
import { type ApiClient, defaultApiClient, type Result } from "./http.js";

const enc = encodeURIComponent;

export function getAccount(client: ApiClient = defaultApiClient): Promise<Result<AccountViewV1>> {
  return client.request<AccountViewV1>("/api/account");
}
export function listProjects(client: ApiClient = defaultApiClient): Promise<Result<readonly ProjectViewV1[]>> {
  return client.request<readonly ProjectViewV1[]>("/api/projects");
}
export function getProject(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<ProjectViewV1>> {
  return client.request<ProjectViewV1>(`/api/projects/${enc(projectId)}`);
}
export function getKnowledgePackage(packageId: string, client: ApiClient = defaultApiClient): Promise<Result<KnowledgePackageViewV1>> {
  return client.request<KnowledgePackageViewV1>(`/api/knowledge-packages/${enc(packageId)}`);
}
export function listKnowledgeIssues(packageId: string, client: ApiClient = defaultApiClient): Promise<Result<readonly KnowledgeIssueViewV1[]>> {
  return client.request<readonly KnowledgeIssueViewV1[]>(`/api/knowledge-packages/${enc(packageId)}/issues`);
}
/** @deprecated P0 has no GET collection route; retained only for legacy callers. */
export function listKnowledgePackages(projectId:string,client:ApiClient=defaultApiClient){return client.request<readonly KnowledgePackageViewV1[]>(`/api/projects/${enc(projectId)}/knowledge-packages`)}
export function confirmKnowledgePackage(packageId: string, client: ApiClient = defaultApiClient): Promise<Result<KnowledgePackageViewV1>> {
  return client.request<KnowledgePackageViewV1>(`/api/knowledge/packages/${enc(packageId)}/confirm`, { method: "POST" });
}
export function listKeywordQuestions(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<readonly KeywordQuestionViewV1[]>> {
  return client.request<readonly KeywordQuestionViewV1[]>(`/api/projects/${enc(projectId)}/keyword-questions`);
}
export function listOpportunities(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<readonly OpportunityViewV1[]>> {
  return client.request<readonly OpportunityViewV1[]>(`/api/projects/${enc(projectId)}/opportunities`);
}
export function listReviewQueue(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<readonly OpportunityViewV1[]>> {
  return client.request<readonly OpportunityViewV1[]>(`/api/projects/${enc(projectId)}/review-queue`);
}
/** @deprecated P0 exposes the review queue, not a decision-history read route. */
export function listReviewDecisions(projectId:string,client:ApiClient=defaultApiClient){return client.request<readonly never[]>(`/api/projects/${enc(projectId)}/review-decisions`)}
export function submitOpportunityReview(
  opportunityId: string,
  input: { readonly reviewReferenceCode: string; readonly reviewVersion: number; readonly decision: "CONFIRMED" | "CHANGES_REQUESTED" | "DEFERRED"; readonly note?: string },
  client: ApiClient = defaultApiClient,
): Promise<Result<HumanReviewDecisionViewV1>> {
  return client.request<HumanReviewDecisionViewV1>(`/api/opportunities/${enc(opportunityId)}/reviews`, { method: "POST", body: input });
}
export function listArticleDeliveries(projectId: string, client: ApiClient = defaultApiClient): Promise<Result<readonly ArticleDeliveryViewV1[]>> {
  return client.request<readonly ArticleDeliveryViewV1[]>(`/api/projects/${enc(projectId)}/deliveries`);
}
export function getAgencyClients(client: ApiClient = defaultApiClient): Promise<Result<AgencyClientPortfolioViewV1>> {
  return client.request<AgencyClientPortfolioViewV1>("/api/agency/clients");
}
export function setAgencyContext(clientOrganizationId: string, client: ApiClient = defaultApiClient): Promise<Result<AgencyActingContextV1>> {
  return client.request<AgencyActingContextV1>("/api/agency/context", { method: "POST", body: { clientOrganizationId } });
}
export function listOrganizations(client: ApiClient = defaultApiClient): Promise<Result<readonly OrganizationSummaryV1[]>> {
  return client.request<readonly OrganizationSummaryV1[]>("/api/ops/organizations");
}
/** @deprecated use listOpsAuditEvents; retained for legacy callers. */
export function listAuditEvents(client:ApiClient=defaultApiClient):Promise<Result<readonly AuditEventViewV1[]>>{return client.request<readonly AuditEventViewV1[]>("/api/ops/audit-events")}
export function listOpsAuditEvents(limit?: number, client: ApiClient = defaultApiClient): Promise<Result<readonly AuditEventViewV1[]>> {
  const query = limit === undefined ? "" : `?limit=${enc(String(limit))}`;
  return client.request<readonly AuditEventViewV1[]>(`/api/ops/audit${query}`);
}
