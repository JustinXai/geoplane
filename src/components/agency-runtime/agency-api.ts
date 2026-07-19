/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — thin, typed endpoint loaders for the AGENCY
 * workspace, layered over the frozen api-client (src/lib/api-client). Import-only usage of
 * the client and the frozen DTOs (src/runtime/api-contracts); this lane invents no parallel
 * DTOs.
 *
 * Why these live here rather than reusing src/lib/api-client/endpoints.ts wholesale: that
 * speculative file types the project-scoped geo reads as `PaginatedV1<T>`, but the real
 * GEO_READ_API_V1 routes (src/app/api/projects/[projectId]/{keyword-questions,review-queue,
 * deliveries}) and GET /api/projects return a BARE array `T[]`. These wrappers therefore call
 * the real paths with the exact response shapes the routes actually return.
 *
 * Every function accepts an optional ApiClient (defaults to the shared defaultApiClient) so
 * pages use the real fetch-backed client while tests inject a fake — mirroring the api-client's
 * own injection convention. No React here: these are plain async functions, unit-testable
 * without a DOM.
 */
import type {
  AgencyClientPortfolioViewV1,
  ArticleDeliveryViewV1,
  KeywordQuestionViewV1,
  OpportunityViewV1,
  ProjectViewV1,
} from "../../runtime/api-contracts/index.js";
// Type-only import of the canonical acting-context DTO (POST /api/agency/context response).
// It lives in the auth runtime, not the frozen contracts barrel; a type-only import is fully
// erased at build time, so no server module is pulled into the client bundle.
import type { AgencyActingContextV1 } from "../../runtime/auth/auth-service.js";
import type { AgencyPortfolioSummary } from "../../runtime/agency-delivery/contracts.js";
import { type ApiClient, defaultApiClient, type Result } from "../../lib/api-client/index.js";

export type { AgencyActingContextV1 };

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// --- Authorized client portfolio -------------------------------------------

/**
 * GET /api/agency/clients — the ACTIVE-assigned client portfolio for the agency session.
 * The route returns ONLY clients the agency has an ACTIVE assignment to; a non-agency role is
 * FORBIDDEN and an unauthenticated caller UNAUTHENTICATED. No client outside the active
 * assignment set can appear in this payload.
 */
export function getAgencyClients(
  client: ApiClient = defaultApiClient,
): Promise<Result<AgencyClientPortfolioViewV1>> {
  return client.request<AgencyClientPortfolioViewV1>("/api/agency/clients");
}

export async function getAgencyPortfolio(
  client: ApiClient = defaultApiClient,
): Promise<Result<AgencyPortfolioSummary>> {
  const authorized = await getAgencyClients(client);
  if (!authorized.ok) return authorized;
  return client.request<AgencyPortfolioSummary>(
    `/api/agency-delivery/portfolio?agencyOrganizationId=${enc(authorized.data.agencyOrganizationId)}`,
  );
}

// --- Acting-for-client context ---------------------------------------------

/**
 * POST /api/agency/context — selects the client this agency session acts for. The route
 * returns FORBIDDEN (never a silent success) when the agency has no ACTIVE assignment to the
 * target client, so an unauthorized client id can never establish a context. On success it
 * returns an AgencyActingContextV1 that carries BOTH the agency identity and the acted-for
 * client identity distinctly, with surface pinned to "agency" — the actor stays the agency.
 */
export function setAgencyContext(
  clientOrganizationId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<AgencyActingContextV1>> {
  return client.request<AgencyActingContextV1>("/api/agency/context", {
    method: "POST",
    body: { clientOrganizationId },
  });
}

// --- Read-side project views (agency-authorized, read-only) -----------------

/**
 * GET /api/projects — the project list the agency principal may see. The route scopes this
 * server-side to the agency's ACTIVE-assigned client organizations, so no unauthorized
 * client's project can appear. Returns a bare ProjectViewV1[].
 */
export function listAgencyProjects(
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly ProjectViewV1[]>> {
  return client.request<readonly ProjectViewV1[]>("/api/projects");
}

/** GET /api/projects/[projectId]/deliveries — read-only ArticleDeliveryViewV1[] for a project. */
export function listClientDeliveries(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly ArticleDeliveryViewV1[]>> {
  return client.request<readonly ArticleDeliveryViewV1[]>(
    `/api/projects/${enc(projectId)}/deliveries`,
  );
}

/** GET /api/projects/[projectId]/review-queue — read-only OpportunityViewV1[] awaiting review. */
export function listClientReviewQueue(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly OpportunityViewV1[]>> {
  return client.request<readonly OpportunityViewV1[]>(
    `/api/projects/${enc(projectId)}/review-queue`,
  );
}

/** GET /api/projects/[projectId]/keyword-questions — read-only KeywordQuestionViewV1[]. */
export function listClientKeywordQuestions(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly KeywordQuestionViewV1[]>> {
  return client.request<readonly KeywordQuestionViewV1[]>(
    `/api/projects/${enc(projectId)}/keyword-questions`,
  );
}
