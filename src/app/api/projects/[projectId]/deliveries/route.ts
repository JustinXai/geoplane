/**
 * GET /api/projects/[projectId]/deliveries — the client Delivery Center data:
 * Two endpoints in one:
 *   - ?view=articles (default): ArticleDeliveryViewV1[], one per article
 *     (the latest draft version of each brief), with a lifecycle status
 *     (IN_PRODUCTION / IN_REVIEW / APPROVED / DELIVERED).
 *   - ?view=receipts: DeliveryReceiptViewV1[], all publication receipts
 *     for the project with delivery details.
 *
 * Unauthenticated -> 401; cross-tenant -> 403; unknown project -> 404.
 * Checkpoint GEO_READ_API_V1 (Agent E4) + Manual Delivery (Agent D).
 */
import { apiOk } from "../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../runtime/auth/http.js";
import {
  requirePrincipal,
  requireReadableProject,
} from "../../../../../runtime/geo/http-guards.js";
import { getGeoRuntime } from "../../../../../runtime/geo/runtime-context.js";
import { toArticleDeliveryViews } from "../../../../../runtime/geo/views.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client-facing view of a delivery receipt. */
export interface DeliveryReceiptViewV1 {
  readonly id: string;
  readonly projectId: string;
  readonly distributionPlanId: string;
  readonly channelId: string;
  readonly publishedByActorId: string;
  readonly publishedAt: string;
  readonly deliveredAt: string;
}

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

  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "articles";

  if (view === "receipts") {
    // Return delivery receipts for the project
    const receipts = await rt.geo.reads.listDeliveryReceiptsByScope({
      clientOrganizationId: project.clientOrganizationId,
      projectId: project.id,
    });
    const receiptViews: DeliveryReceiptViewV1[] = receipts.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      distributionPlanId: r.distributionPlanId,
      channelId: r.channelId,
      publishedByActorId: r.publishedByActorId,
      publishedAt: r.publishedAt,
      deliveredAt: r.deliveredAt,
    }));
    return toHttpResponse(apiOk(receiptViews));
  }

  // Default: return article delivery status views
  const models = await rt.geo.reads.listDeliveryArticlesByScope({
    clientOrganizationId: project.clientOrganizationId,
    projectId: project.id,
  });
  return toHttpResponse(apiOk(toArticleDeliveryViews(models)));
}
