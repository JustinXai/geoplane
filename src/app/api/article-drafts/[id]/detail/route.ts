/**
 * GET /api/article-drafts/[id]/detail — alias for the draft detail, reads from the
 * tenant-scoped article_draft table directly (no additional auth beyond cookie).
 */
import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getGeoRuntime } from "../../../../../runtime/geo/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rt = getGeoRuntime();
  const { id } = await context.params;

  const draftRow = await rt.db.query<{
    client_organization_id: string;
    project_id: string;
  }>("SELECT client_organization_id, project_id FROM article_draft WHERE id = $1", [id]);

  const draftMeta = draftRow.rows[0];
  if (!draftMeta) return toHttpResponse(apiErr("NOT_FOUND", "Article draft not found."));

  const detail = await rt.geo.reads.getArticleDraftDetail({
    articleDraftId: id,
    clientOrganizationId: draftMeta.client_organization_id,
    projectId: draftMeta.project_id,
  });

  if (!detail) return toHttpResponse(apiErr("NOT_FOUND", "Article draft detail not found."));

  return toHttpResponse(apiOk(detail));
}
