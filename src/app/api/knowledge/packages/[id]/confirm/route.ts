/**
 * POST /api/knowledge/packages/[id]/confirm — move the package to CONFIRMED (stamps confirmed_at/by)
 * and return the refreshed KnowledgePackageViewV1. Missing package -> 404; cross-tenant -> 403
 * (checkpoint KNOWLEDGE_API_V1, Agent D3).
 */
import { apiErr, apiOk } from "@/runtime/api-contracts/index.js";
import { toHttpResponse } from "@/runtime/auth/http.js";
import { recordKnowledgeAudit } from "@/runtime/knowledge/audit.js";
import {
  requireOwnedPackage,
  requirePrincipal,
} from "@/runtime/knowledge/http-guards.js";
import { PgKnowledgePackageRepository } from "@/runtime/knowledge/pg/package-repository.js";
import { getKnowledgeRuntime } from "@/runtime/knowledge/runtime-context.js";
import { toPackageView } from "@/runtime/knowledge/views.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rt = getKnowledgeRuntime();
  const { id } = await context.params;

  const principalGuard = await requirePrincipal(rt, request);
  if ("response" in principalGuard) return principalGuard.response;
  const principal = principalGuard.value;

  const pkgGuard = await requireOwnedPackage(rt, principal, id);
  if ("response" in pkgGuard) return pkgGuard.response;
  const pkg = pkgGuard.value;

  await rt.db.transaction(async (tx) => {
    await new PgKnowledgePackageRepository(tx).confirm(pkg.id, principal.userId);
    await recordKnowledgeAudit(tx, principal, {
      action: "knowledge_package.confirmed",
      clientOrganizationId: pkg.clientOrganizationId,
      projectId: pkg.projectId,
      targetType: "knowledge_package",
      targetId: pkg.id,
    });
  });

  const withCounts = await rt.knowledge.packages.getWithCounts(
    pkg.id,
    pkg.clientOrganizationId,
  );
  if (!withCounts) {
    return toHttpResponse(apiErr("NOT_FOUND", "Knowledge package not found."));
  }
  return toHttpResponse(apiOk(toPackageView(withCounts)));
}
