/**
 * POST /api/commands/projects/[projectId]/knowledge-packages — creates a KnowledgePackage (the
 * canonical enterprise-knowledge record, migration 0002) AND emits a `knowledge_package.created`
 * audit event with the real creating actor.
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2) — KNOWLEDGE AUDIT-GAP CLOSURE. The knowledge runtime
 * has an audited creation path only inside the composition root's `createPackage`; the plain
 * knowledge HTTP write routes do not emit that event. Rather than reach into src/runtime/knowledge
 * (out of this lane), this NEW command route this lane owns wraps the knowledge package repository
 * with the SAME audited create the composition performs (see geo-command-runtime.createKnowledgePackage),
 * so enterprise-knowledge creation is auditable through a route in this lane.
 *
 * Server-side tenant resolution: the client org is the project's owning client org, from the
 * session's grants — never a body value. Cross-tenant -> 403 + DENIED audit. Idempotency-Key makes
 * a retried create yield ONE package.
 */
import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../../runtime/auth/runtime-context.js";
import type { KnowledgePackageCommandViewV1 } from "../../../../../../runtime/commands/geo-dto.js";
import {
  createGeoCommandRuntime,
  invokeDomain,
} from "../../../../../../runtime/commands/geo-command-runtime.js";
import {
  denyIfCrossTenant,
  isResponse,
  requireSession,
} from "../../../../../../runtime/commands/geo-command-http.js";
import { readString } from "../../../../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "knowledge_package.command.create";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { projectId } = await context.params;

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const project = await rt.repos.projects.findById(projectId);
  if (!project) return toHttpResponse(apiErr("NOT_FOUND", "Project not found."));
  const tenant = { clientOrganizationId: project.clientOrganizationId, projectId: project.id };

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "knowledge_package");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const title = readString(body, "title");
  if (!title) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "title is required."));
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<KnowledgePackageCommandViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const pkg = await invokeDomain(() =>
          geo.createKnowledgePackage({
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            title,
            createdByUserId: actor.userId,
          }),
        );
        const view: KnowledgePackageCommandViewV1 = {
          id: pkg.id,
          clientOrganizationId: pkg.clientOrganizationId,
          projectId: pkg.projectId,
          title: pkg.title,
          status: pkg.status,
          createdAt: pkg.createdAt,
          confirmedAt: pkg.confirmedAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "knowledge_package",
            targetId: pkg.id,
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
