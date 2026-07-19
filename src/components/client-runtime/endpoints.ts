/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — typed data loaders for the CLIENT workspace,
 * built on F1's ApiClient (src/lib/api-client/http.ts) and the frozen View DTOs.
 *
 * Why these live here instead of reusing src/lib/api-client/endpoints.ts: the finalized
 * runtime routes (src/app/api/**) return the list resources as PLAIN ARRAYS and expose the
 * knowledge package under /api/knowledge/packages/[id], whereas the frozen endpoints.ts
 * (written before the routes were finalized) types the lists as PaginatedV1 and points at
 * /api/knowledge-packages/[id]. Those frozen wrappers are import-only for this lane and are
 * mis-typed/mis-pathed against the real routes, so the loaders below call the same typed
 * ApiClient.request with the ACTUAL route paths and the ACTUAL response types. No DTO is
 * re-invented — every type is imported from the frozen contract.
 */
import type {
  AccountViewV1,
  ArticleDeliveryViewV1,
  KeywordQuestionViewV1,
  KnowledgeIssueViewV1,
  KnowledgePackageViewV1,
  OpportunityViewV1,
  ProjectViewV1,
} from "../../runtime/api-contracts/index.js";
import { type ApiClient, defaultApiClient, ok, type Result } from "../../lib/api-client/http.js";
import { selectActiveProject } from "./view-models.js";
import { safeBusinessDisplayName } from "../../runtime/ui-adapters/formatters.js";
import type { BaiduKeywordReadModel, ClientKnowledgeProgressReadModel } from "../../runtime/read-models/domestic-workspaces.js";
import type { KeywordExpansionBatch } from "../../runtime/keyword-expansion/contract.js";
import type { RawProbeResult } from "../../runtime/probes/manual-sample.js";

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// --- Account / projects -----------------------------------------------------

export function loadAccount(client: ApiClient = defaultApiClient): Promise<Result<AccountViewV1>> {
  return client.request<AccountViewV1>("/api/account");
}

export async function loadProjects(
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly ProjectViewV1[]>> {
  const result = await client.request<readonly ProjectViewV1[]>("/api/projects");
  if (!result.ok) return result;
  return { ok: true, data: result.data.map((project) => ({
    ...project,
    name: safeBusinessDisplayName(project.name, "项目"),
    clientOrganizationName: safeBusinessDisplayName(project.clientOrganizationName),
  })) };
}

// --- Knowledge base (readiness + issues) -----------------------------------

export function loadKnowledgePackage(
  packageId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<KnowledgePackageViewV1>> {
  return client.request<KnowledgePackageViewV1>(`/api/knowledge/packages/${enc(packageId)}`);
}

export function loadKnowledgeIssues(
  packageId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly KnowledgeIssueViewV1[]>> {
  return client.request<readonly KnowledgeIssueViewV1[]>(
    `/api/knowledge/packages/${enc(packageId)}/issues`,
  );
}

// --- Project-scoped read resources -----------------------------------------

export function loadKeywordQuestions(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly KeywordQuestionViewV1[]>> {
  return client.request<readonly KeywordQuestionViewV1[]>(
    `/api/projects/${enc(projectId)}/keyword-questions`,
  );
}

export function loadDeliveries(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly ArticleDeliveryViewV1[]>> {
  return client.request<readonly ArticleDeliveryViewV1[]>(
    `/api/projects/${enc(projectId)}/deliveries`,
  );
}

export function loadOpportunities(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly OpportunityViewV1[]>> {
  return client.request<readonly OpportunityViewV1[]>(
    `/api/projects/${enc(projectId)}/opportunities`,
  );
}

// --- Composite: resolve the active project, then its scoped resource --------
//
// The keyword / delivery / content screens carry no project in their route, so each
// resolves the caller's project list first, selects the active project (first by default,
// matching the dashboard's default), then loads the scoped resource. A failed project load
// (401/403/500) is propagated unchanged so the screen shows the right state; no project ->
// an empty payload -> the screen's Empty state.

async function withActiveProject<T>(
  client: ApiClient,
  load: (projectId: string, client: ApiClient) => Promise<Result<T>>,
  emptyValue: T,
): Promise<Result<T>> {
  const projects = await loadProjects(client);
  if (!projects.ok) return projects;
  const active = selectActiveProject(projects.data);
  if (active === null) return ok(emptyValue);
  return load(active.id, client);
}

export function loadActiveProjectKeywords(
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly KeywordQuestionViewV1[]>> {
  return withActiveProject(client, loadKeywordQuestions, []);
}

export function loadActiveProjectDeliveries(
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly ArticleDeliveryViewV1[]>> {
  return withActiveProject(client, loadDeliveries, []);
}

export function loadActiveProjectOpportunities(
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly OpportunityViewV1[]>> {
  return withActiveProject(client, loadOpportunities, []);
}

export interface ClientOverviewData {
  readonly project: ProjectViewV1;
  readonly keywords: readonly KeywordQuestionViewV1[];
  readonly opportunities: readonly OpportunityViewV1[];
  readonly deliveries: readonly ArticleDeliveryViewV1[];
  readonly knowledge: ClientKnowledgeProgressReadModel;
  readonly baidu: BaiduKeywordReadModel;
  readonly expansionBatches: readonly KeywordExpansionBatch[];
  readonly probes: readonly RawProbeResult[];
}

export function loadKnowledgeProgress(projectId:string,client:ApiClient=defaultApiClient):Promise<Result<ClientKnowledgeProgressReadModel>>{
  return client.request<ClientKnowledgeProgressReadModel>(`/api/projects/${enc(projectId)}/knowledge-progress`);
}

export function loadBaiduKeywordProgress(projectId:string,client:ApiClient=defaultApiClient):Promise<Result<BaiduKeywordReadModel>>{
  return client.request<BaiduKeywordReadModel>(`/api/keywords/projects/${enc(projectId)}/overview`);
}

export function loadExpansionProgress(projectId:string,client:ApiClient=defaultApiClient):Promise<Result<readonly KeywordExpansionBatch[]>>{
  return client.request<readonly KeywordExpansionBatch[]>(`/api/keyword-expansion/projects/${enc(projectId)}`);
}

export function loadProbeProgress(projectId:string,client:ApiClient=defaultApiClient):Promise<Result<readonly RawProbeResult[]>>{
  return client.request<readonly RawProbeResult[]>(`/api/probes/projects/${enc(projectId)}/manual-samples`);
}

/** Loads only persisted, client-scoped resources used by the overview. */
export async function loadClientOverview(
  client: ApiClient = defaultApiClient,
): Promise<Result<ClientOverviewData | null>> {
  const projects = await loadProjects(client);
  if (!projects.ok) return projects;
  const project = selectActiveProject(projects.data);
  if (project === null) return ok(null);

  const [keywords, opportunities, deliveries, knowledge, baidu, expansionBatches, probes] = await Promise.all([
    loadKeywordQuestions(project.id, client),
    loadOpportunities(project.id, client),
    loadDeliveries(project.id, client),
    loadKnowledgeProgress(project.id,client),
    loadBaiduKeywordProgress(project.id,client),
    loadExpansionProgress(project.id,client),
    loadProbeProgress(project.id,client),
  ]);
  if (!keywords.ok) return keywords;
  if (!opportunities.ok) return opportunities;
  if (!deliveries.ok) return deliveries;
  if (!knowledge.ok) return knowledge;
  if (!baidu.ok) return baidu;
  if (!expansionBatches.ok) return expansionBatches;
  if (!probes.ok) return probes;
  return ok({ project, keywords: keywords.data, opportunities: opportunities.data, deliveries: deliveries.data,
    knowledge:knowledge.data,baidu:baidu.data,expansionBatches:expansionBatches.data,probes:probes.data });
}
