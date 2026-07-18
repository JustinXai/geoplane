/**
 * POST /api/knowledge/packages/[id]/snapshots — seal a new immutable snapshot of a package and
 * emit a `knowledge.snapshot.created` AuditEvent with the real, session-derived actor
 * (checkpoint KNOWLEDGE_AUDIT_CLOSURE_V1, Agent C).
 *
 * The content hash and document count are derived SERVER-SIDE from the package's current
 * documents/versions — never taken from the request body — so the seal reflects real persisted
 * content. The package must belong to the caller's client organization (else 403). Returns a
 * leak-free KnowledgeSnapshotViewV1 (the sealed content hash is not surfaced).
 */
import { createHash } from "node:crypto";
import { apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { recordKnowledgeAudit } from "../../../../../../runtime/knowledge/audit.js";
import {
  requireOwnedPackage,
  requirePrincipal,
} from "../../../../../../runtime/knowledge/http-guards.js";
import { getKnowledgeRuntime } from "../../../../../../runtime/knowledge/runtime-context.js";
import { toSnapshotView } from "../../../../../../runtime/knowledge/views.js";

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

  // Seal fingerprint: a stable hash over each document's latest-version content hash. Derived from
  // persisted rows, so the same content always seals to the same hash and never trusts the body.
  const documents = await rt.knowledge.documents.listByPackage(pkg.id);
  const parts: string[] = [];
  for (const doc of documents) {
    const latest = await rt.knowledge.versions.getLatest(doc.id);
    parts.push(`${doc.id}:${latest ? `${latest.versionNumber}:${latest.contentHash}` : "0:"}`);
  }
  parts.sort();
  const contentHash = createHash("sha256").update(parts.join("\n")).digest("hex");

  // The snapshot repository owns its own transaction (supersede-then-insert). Emit the single
  // AuditEvent immediately after, in the same request, scoped to the package's tenant.
  const snapshot = await rt.knowledge.snapshots.create({
    clientOrganizationId: pkg.clientOrganizationId,
    projectId: pkg.projectId,
    packageId: pkg.id,
    contentHash,
    documentCount: documents.length,
    createdByUserId: principal.userId,
    classification: pkg.classification,
  });

  await recordKnowledgeAudit(rt.db, principal, {
    action: "knowledge.snapshot.created",
    clientOrganizationId: pkg.clientOrganizationId,
    projectId: pkg.projectId,
    targetType: "knowledge_snapshot",
    targetId: snapshot.id,
    metadata: { packageId: pkg.id, snapshotNumber: snapshot.snapshotNumber, documentCount: snapshot.documentCount },
  });

  return toHttpResponse(apiOk(toSnapshotView(snapshot)), { okStatus: 201 });
}
