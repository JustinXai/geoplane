/**
 * GET /api/projects/[projectId]/briefs — lists ArticleBriefs for a project scope.
 *
 * GEO_READ_API_V1 checkpoint.
 */
import { apiOk } from "../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getGeoRuntime } from "../../../../../runtime/geo/runtime-context.js";
import { requirePrincipal, requireReadableProject } from "../../../../../runtime/geo/http-guards.js";

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

  const items = await rt.geo.reads.listArticleBriefsWithDraftAndGateStatus({
    clientOrganizationId: projectGuard.value.clientOrganizationId,
    projectId: projectGuard.value.id,
  });

  return toHttpResponse(apiOk(items));
}
