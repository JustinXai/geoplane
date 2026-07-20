/**
 * GET /api/article-drafts — lists all ArticleDrafts for the authenticated client
 * (server-side tenant resolution from session; body carries no org id).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 */
import { apiErr, apiOk } from "../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../runtime/auth/runtime-context.js";
import type { ArticleDraftCommandViewV1 } from "../../../runtime/commands/geo-dto.js";
import { createGeoCommandRuntime } from "../../../runtime/commands/geo-command-runtime.js";
import { isResponse, requireSession } from "../../../runtime/commands/geo-command-http.js";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  try {
    const geo = createGeoCommandRuntime(rt.db);
    const drafts = await geo.repos.articleDrafts.listByOrganization(session.organizationId);
    const views: ArticleDraftCommandViewV1[] = drafts
      .filter((d) => d.status === "DRAFT")
      .map((d) => ({
      id: d.id, clientOrganizationId: d.clientOrganizationId, projectId: d.projectId,
      articleBriefId: d.articleBriefId, version: d.version, title: d.title,
      status: d.status, sectionCount: d.sections.length,
      sourceProviderArticleContentIds: d.sourceProviderArticleContentIds, compiledAt: d.compiledAt,
    }));
    return toHttpResponse(apiOk(views));
  } catch (err) {
    console.error("GET /api/article-drafts failed:", err);
    return toHttpResponse(apiErr("INTERNAL_ERROR", "Failed to load article drafts."));
  }
}
