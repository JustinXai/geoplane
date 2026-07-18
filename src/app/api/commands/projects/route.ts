/**
 * POST /api/commands/projects — creates a Project under a CLIENT organization the caller is
 * authorized for.
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 1).
 *
 * Route location note: the requested path was POST /api/projects, but a GET route.ts already
 * exists at src/app/api/projects/ and the Next.js App Router allows only ONE route.ts per path.
 * This lane must NOT modify that existing file, so the create command is mounted here, under this
 * lane's exclusive /api/commands/** namespace.
 *
 * Server-side tenant resolution (SYSTEM_INVARIANTS_V1.md) — the target client org is decided from
 * the SESSION, never trusted from the body:
 *   - CLIENT_OWNER  -> always their own pinned client org; any body clientOrganizationId is IGNORED.
 *   - AGENCY_*      -> the body clientOrganizationId, but only if it is in the session's ACTIVE
 *                      assignment set; otherwise 403 FORBIDDEN + a DENIED audit event.
 *   - PLATFORM      -> the body clientOrganizationId, validated to be an existing CLIENT org.
 * Idempotency-Key (header/body) makes a retried create yield ONE project.
 */
import { apiErr, apiOk, type ProjectViewV1 } from "../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  readStringField,
  recordDeniedCommand,
  runWriteCommand,
} from "../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "project.create";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const actor = { userId: session.userId, organizationId: session.organizationId };

  const body = await readJsonBody(request);
  const name = readStringField(body, "name");
  if (!name) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "name is required."));
  }
  // Read only to be explicitly ignored for CLIENT_OWNER (the anti-smuggle case).
  const bodyClientOrganizationId = readStringField(body, "clientOrganizationId");

  // ---- Resolve the target client org SERVER-SIDE from the session's role/grants. --------------
  let targetClientOrganizationId: string;
  if (session.role === "CLIENT_OWNER") {
    // Pinned to the caller's own client org; the body value is never trusted.
    targetClientOrganizationId = session.activeClientOrganizationId ?? session.organizationId;
  } else if (session.role === "AGENCY_OWNER" || session.role === "AGENCY_OPERATOR") {
    if (!bodyClientOrganizationId) {
      return toHttpResponse(
        apiErr("VALIDATION_FAILED", "clientOrganizationId is required for an agency."),
      );
    }
    if (!session.assignedClientOrganizationIds.includes(bodyClientOrganizationId)) {
      await recordDeniedCommand(rt.db, actor, ACTION, {
        clientOrganizationId: bodyClientOrganizationId,
        targetType: "project",
      });
      return toHttpResponse(
        apiErr("FORBIDDEN", "Agency is not assigned to that client organization."),
      );
    }
    targetClientOrganizationId = bodyClientOrganizationId;
  } else {
    // PLATFORM_SUPER_ADMIN: any named CLIENT org (existence/type verified inside the transaction).
    if (!bodyClientOrganizationId) {
      return toHttpResponse(
        apiErr("VALIDATION_FAILED", "clientOrganizationId is required."),
      );
    }
    targetClientOrganizationId = bodyClientOrganizationId;
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<ProjectViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const clientOrg = await ctx.repos.organizations.findById(targetClientOrganizationId);
        if (!clientOrg || clientOrg.type !== "CLIENT") {
          throw new CommandAbortError(
            "VALIDATION_FAILED",
            "Target organization does not exist or is not a CLIENT organization.",
          );
        }

        const project = await ctx.repos.projects.create({
          clientOrganizationId: clientOrg.id,
          name,
          createdByUserId: ctx.actor.userId,
        });

        const view: ProjectViewV1 = {
          id: project.id,
          name: project.name,
          clientOrganizationId: project.clientOrganizationId,
          clientOrganizationName: clientOrg.displayName,
          createdAt: project.createdAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: project.clientOrganizationId,
            projectId: project.id,
            targetType: "project",
            targetId: project.id,
          },
        };
      },
    });

    return toHttpResponse(apiOk(dto));
  } catch (err) {
    if (err instanceof CommandAbortError) {
      return toHttpResponse(err.response);
    }
    throw err;
  }
}
