/**
 * GET /api/projects/[projectId]/keyword-questions — the KeywordQuestionViewV1[]
 * for a project (every keyword <-> user-question mapping in scope), ordered by a
 * deterministic priority. Unauthenticated -> 401; cross-tenant -> 403; unknown
 * project -> 404. Checkpoint GEO_READ_API_V1 (Agent E4).
 */
import { apiOk } from "../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../runtime/auth/http.js";
import {
  requirePrincipal,
  requireReadableProject,
} from "../../../../../runtime/geo/http-guards.js";
import { getGeoRuntime } from "../../../../../runtime/geo/runtime-context.js";
import { toKeywordQuestionViews } from "../../../../../runtime/geo/views.js";

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

  const maps = await rt.geo.keywordQuestionMaps.listByScope({
    clientOrganizationId: project.clientOrganizationId,
    projectId: project.id,
  });
  return toHttpResponse(apiOk(toKeywordQuestionViews(maps)));
}
