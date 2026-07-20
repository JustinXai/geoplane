/**
 * POST /api/knowledge/packages/[id]/issues/[issueId]/resolve — mark a package's quality finding
 * resolved and emit a `knowledge_issue.resolved` AuditEvent with the real, session-derived actor
 * (checkpoint KNOWLEDGE_AUDIT_CLOSURE_V1, Agent C).
 *
 * The package must belong to the caller's client organization (else 403), and the issue must
 * belong to that package (else 404) — both re-derived server-side, never trusted from the body.
 * Resolving an already-resolved issue is idempotent: it returns the current view and writes NO new
 * audit (no state change -> no duplicate event).
 */
import { apiErr, apiOk } from "@/runtime/api-contracts/index.js";
import { toHttpResponse } from "@/runtime/auth/http.js";
import { recordKnowledgeAudit } from "@/runtime/knowledge/audit.js";
import {
  requireOwnedPackage,
  requirePrincipal,
} from "@/runtime/knowledge/http-guards.js";
import { PgKnowledgeIssueRepository } from "@/runtime/knowledge/pg/issue-repository.js";
import { getKnowledgeRuntime } from "@/runtime/knowledge/runtime-context.js";
import { toIssueView } from "@/runtime/knowledge/views.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; issueId: string }> },
): Promise<Response> {
  const rt = getKnowledgeRuntime();
  const { id, issueId } = await context.params;

  const principalGuard = await requirePrincipal(rt, request);
  if ("response" in principalGuard) return principalGuard.response;
  const principal = principalGuard.value;

  const pkgGuard = await requireOwnedPackage(rt, principal, id);
  if ("response" in pkgGuard) return pkgGuard.response;
  const pkg = pkgGuard.value;

  const issues = await rt.knowledge.issues.listByPackage(pkg.id);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) {
    return toHttpResponse(apiErr("NOT_FOUND", "Knowledge issue not found."));
  }
  if (issue.resolved) {
    return toHttpResponse(apiOk(toIssueView(issue)));
  }

  const resolved = await rt.db.transaction(async (tx) => {
    const updated = await new PgKnowledgeIssueRepository(tx).resolve(issueId, principal.userId);
    await recordKnowledgeAudit(tx, principal, {
      action: "knowledge_issue.resolved",
      clientOrganizationId: pkg.clientOrganizationId,
      projectId: pkg.projectId,
      targetType: "knowledge_issue",
      targetId: updated.id,
      metadata: { packageId: pkg.id, kind: updated.kind, severity: updated.severity },
    });
    return updated;
  });

  return toHttpResponse(apiOk(toIssueView(resolved)));
}
