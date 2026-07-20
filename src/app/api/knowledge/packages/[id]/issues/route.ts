/**
 * GET /api/knowledge/packages/[id]/issues — list the package's quality findings as
 * KnowledgeIssueViewV1[]. Missing package -> 404; cross-tenant -> 403 (KNOWLEDGE_API_V1, D3).
 */
import { apiOk } from "@/runtime/api-contracts/index.js";
import { toHttpResponse } from "@/runtime/auth/http.js";
import {
  requireOwnedPackage,
  requirePrincipal,
} from "@/runtime/knowledge/http-guards.js";
import { getKnowledgeRuntime } from "@/runtime/knowledge/runtime-context.js";
import { toIssueView } from "@/runtime/knowledge/views.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

  const issues = await rt.knowledge.issues.listByPackage(pkg.id);
  return toHttpResponse(apiOk(issues.map(toIssueView)));
}
