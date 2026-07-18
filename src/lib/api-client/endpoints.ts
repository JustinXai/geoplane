/**
 * FRONTEND_API_CLIENT_V1 — thin typed endpoint functions over http.ts.
 *
 * Each function calls the shared ApiClient with a fixed path/method and is typed to
 * the exact frozen View DTO it returns. Routes themselves are a LATER checkpoint
 * (Agents C/D/E); these paths are the REST surface the frozen DTOs imply and are the
 * single place the frontend needs to update if a route path is finalised differently.
 *
 * Every function accepts an optional ApiClient (defaults to defaultApiClient) so callers
 * and tests can inject a client backed by a fake fetch.
 */
import type {
  AccountViewV1,
  AgencyClientPortfolioViewV1,
  ArticleDeliveryViewV1,
  AuditEventViewV1,
  ClientReviewDecisionViewV1,
  KeywordQuestionViewV1,
  KnowledgeIssueViewV1,
  KnowledgePackageViewV1,
  OpportunityViewV1,
  PaginatedV1,
  ProjectViewV1,
} from "../../runtime/api-contracts/index.js";
import { type ApiClient, defaultApiClient, type Result } from "./http.js";

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// --- Account / session -----------------------------------------------------

/** The signed-in user's account + active workspace surface. */
export function getAccount(client: ApiClient = defaultApiClient): Promise<Result<AccountViewV1>> {
  return client.request<AccountViewV1>("/api/account");
}

// --- Projects --------------------------------------------------------------

export function listProjects(
  client: ApiClient = defaultApiClient,
): Promise<Result<PaginatedV1<ProjectViewV1>>> {
  return client.request<PaginatedV1<ProjectViewV1>>("/api/projects");
}

export function getProject(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<ProjectViewV1>> {
  return client.request<ProjectViewV1>(`/api/projects/${enc(projectId)}`);
}

// --- Knowledge base --------------------------------------------------------

export function listKnowledgePackages(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<PaginatedV1<KnowledgePackageViewV1>>> {
  return client.request<PaginatedV1<KnowledgePackageViewV1>>(
    `/api/projects/${enc(projectId)}/knowledge-packages`,
  );
}

export function getKnowledgePackage(
  packageId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<KnowledgePackageViewV1>> {
  return client.request<KnowledgePackageViewV1>(`/api/knowledge-packages/${enc(packageId)}`);
}

export function listKnowledgeIssues(
  packageId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<PaginatedV1<KnowledgeIssueViewV1>>> {
  return client.request<PaginatedV1<KnowledgeIssueViewV1>>(
    `/api/knowledge-packages/${enc(packageId)}/issues`,
  );
}

// --- Keywords / opportunities ---------------------------------------------

export function listKeywordQuestions(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<PaginatedV1<KeywordQuestionViewV1>>> {
  return client.request<PaginatedV1<KeywordQuestionViewV1>>(
    `/api/projects/${enc(projectId)}/keyword-questions`,
  );
}

export function listOpportunities(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<PaginatedV1<OpportunityViewV1>>> {
  return client.request<PaginatedV1<OpportunityViewV1>>(
    `/api/projects/${enc(projectId)}/opportunities`,
  );
}

// --- Client review decisions ----------------------------------------------

export function listReviewDecisions(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<PaginatedV1<ClientReviewDecisionViewV1>>> {
  return client.request<PaginatedV1<ClientReviewDecisionViewV1>>(
    `/api/projects/${enc(projectId)}/review-decisions`,
  );
}

// --- Article delivery ------------------------------------------------------

export function listArticleDeliveries(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<PaginatedV1<ArticleDeliveryViewV1>>> {
  return client.request<PaginatedV1<ArticleDeliveryViewV1>>(
    `/api/projects/${enc(projectId)}/deliveries`,
  );
}

// --- Agency portfolio ------------------------------------------------------

export function getAgencyClients(
  client: ApiClient = defaultApiClient,
): Promise<Result<AgencyClientPortfolioViewV1>> {
  return client.request<AgencyClientPortfolioViewV1>("/api/agency/clients");
}

// --- Ops audit -------------------------------------------------------------

export function listAuditEvents(
  client: ApiClient = defaultApiClient,
): Promise<Result<PaginatedV1<AuditEventViewV1>>> {
  return client.request<PaginatedV1<AuditEventViewV1>>("/api/ops/audit-events");
}
