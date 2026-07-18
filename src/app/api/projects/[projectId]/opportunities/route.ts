/**
 * GET /api/projects/[projectId]/opportunities — the OpportunityViewV1[] for a
 * project, each with a client-facing lifecycle status derived from its validation
 * + human-review outcomes. Unauthenticated -> 401; cross-tenant -> 403; unknown
 * project -> 404. Checkpoint GEO_READ_API_V1 (Agent E4).
 */
import { apiOk } from "../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../runtime/auth/http.js";
import {
  requirePrincipal,
  requireReadableProject,
} from "../../../../../runtime/geo/http-guards.js";
import { getGeoRuntime } from "../../../../../runtime/geo/runtime-context.js";
import { toOpportunityViews } from "../../../../../runtime/geo/views.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const rt = getGeoRuntime();
  const { projectId } = await context.params;

  const principalGuard = await requirePrincipal(rt, request);
  if ("response" in principalGuard) return principalGuard.response;

  const projectGuard = await requireReadableProject(rt, principalGuard.value, projectId);
  if ("response" in projectGuard) return projectGuard.response;
  const project = projectGuard.value;

  const scope = {
    clientOrganizationId: project.clientOrganizationId,
    projectId: project.id,
  };
  const [opportunities, validations, reviews] = await Promise.all([
    rt.geo.opportunities.listByScope(scope),
    rt.geo.reads.listOpportunityValidationsByScope(scope),
    rt.geo.humanReviews.listByScope(scope),
  ]);
  return toHttpResponse(apiOk(toOpportunityViews(opportunities, validations, reviews)));
}
