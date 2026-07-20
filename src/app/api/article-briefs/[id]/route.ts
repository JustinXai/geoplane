/**
 * GET /api/article-briefs/[id] — reads one ArticleBrief by id
 * (server-side tenant resolution; cross-tenant -> 403).
 *
 * PUT not supported: briefs are append-only (revision = new brief).
 *
 * Agent B (p0-b-opportunity-brief-direct-flow-v1).
 */
import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import type { ArticleBriefViewV1 } from "../../../../runtime/commands/geo-dto.js";
import {
  createGeoCommandRuntime,
  denyIfCrossTenant,
  isResponse,
  requireSession,
} from "../../../../runtime/commands/geo-command-runtime.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };
  const { id } = await context.params;

  const geo = createGeoCommandRuntime(rt.db);
  const brief = await geo.repos.articleBriefs.getById(id);
  if (!brief) {
    return apiErr("NOT_FOUND", "Article brief not found.") as Response;
  }

  const denied = await denyIfCrossTenant(
    rt,
    session,
    actor,
    { clientOrganizationId: brief.clientOrganizationId, projectId: brief.projectId },
    "article_brief.read",
    "ArticleBrief",
  );
  if (denied) return denied;

  const view: ArticleBriefViewV1 = {
    id: brief.id,
    clientOrganizationId: brief.clientOrganizationId,
    projectId: brief.projectId,
    opportunityFamilyId: brief.opportunityFamilyId,
    workingTitle: brief.workingTitle,
    outline: brief.outline,
    riskLevel: brief.planningContext.riskLevel,
    createdAt: brief.createdAt,
  };
  return apiOk(view) as Response;
}
