/**
 * POST /api/commands/projects/[projectId]/knowledge-packages/[id]/confirm — confirms (seals) a
 * KnowledgePackage AND emits a `knowledge_package.confirmed` audit event with the real confirming
 * actor.
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2) — KNOWLEDGE AUDIT-GAP CLOSURE (the confirm half). Same
 * rationale as the sibling create route: the audited confirm mirrors the composition's audited
 * knowledge path from a command route this lane owns, rather than editing src/runtime/knowledge.
 *
 * A CONFIRMED knowledge package is immutable history; this route never mutates the package's content
 * — it performs the one status transition the knowledge runtime exposes and records it. Cross-tenant
 * -> 403 + DENIED audit. Idempotency-Key makes a retried confirm replay the first result.
 */
import { apiErr, apiOk } from "../../../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../../../../runtime/auth/runtime-context.js";
import type { KnowledgePackageCommandViewV1 } from "../../../../../../../../runtime/commands/geo-dto.js";
import {
  createGeoCommandRuntime,
  invokeDomain,
} from "../../../../../../../../runtime/commands/geo-command-runtime.js";
import {
  denyIfCrossTenant,
  isResponse,
  requireSession,
} from "../../../../../../../../runtime/commands/geo-command-http.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "knowledge_package.command.confirm";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; id: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { projectId, id } = await context.params;

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const project = await rt.repos.projects.findById(projectId);
  if (!project) return toHttpResponse(apiErr("NOT_FOUND", "Project not found."));
  const tenant = { clientOrganizationId: project.clientOrganizationId, projectId: project.id };

  // The referenced package must belong to this project's tenant — resolved server-side, never trusted.
  const pkg = await createGeoCommandRuntime(rt.db).knowledgePackageStore.findById(id);
  if (
    !pkg ||
    pkg.clientOrganizationId !== tenant.clientOrganizationId ||
    pkg.projectId !== tenant.projectId
  ) {
    return toHttpResponse(apiErr("NOT_FOUND", "Knowledge package not found for this project."));
  }

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "knowledge_package");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<KnowledgePackageCommandViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const confirmed = await invokeDomain(() =>
          geo.confirmKnowledgePackage(id, actor.userId, tenant),
        );
        const view: KnowledgePackageCommandViewV1 = {
          id: confirmed.id,
          clientOrganizationId: confirmed.clientOrganizationId,
          projectId: confirmed.projectId,
          title: confirmed.title,
          status: confirmed.status,
          createdAt: confirmed.createdAt,
          confirmedAt: confirmed.confirmedAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "knowledge_package",
            targetId: confirmed.id,
          },
        };
      },
    });
    return toHttpResponse(apiOk(dto));
  } catch (err) {
    if (err instanceof CommandAbortError) return toHttpResponse(err.response);
    throw err;
  }
}
