/**
 * POST /api/ops/assignments — a PLATFORM_SUPER_ADMIN assigns an AGENCY organization to a CLIENT
 * organization (creates the ACTIVE agency_client_assignment that grants access).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 1). The two org ids in the body are operation TARGETS
 * a platform admin names; they are validated to exist with the right types and are never treated
 * as the caller's own tenant (which comes from the session). Non-platform callers get 403 +
 * DENIED audit. Idempotency-Key (header/body) makes a retried assign yield ONE assignment; a
 * fresh duplicate of an already-ACTIVE pair is a 409 CONFLICT rather than a second row.
 */
import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import type { AgencyClientAssignmentViewV1 } from "../../../../runtime/commands/dto.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  readStringField,
  recordDeniedCommand,
  runWriteCommand,
} from "../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "ops.assignment.create";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const actor = { userId: session.userId, organizationId: session.organizationId };

  if (session.role !== "PLATFORM_SUPER_ADMIN") {
    await recordDeniedCommand(rt.db, actor, ACTION, { targetType: "agency_client_assignment" });
    return toHttpResponse(
      apiErr("FORBIDDEN", "Only a platform super admin may assign agencies to clients."),
    );
  }

  const body = await readJsonBody(request);
  const agencyOrganizationId = readStringField(body, "agencyOrganizationId");
  const clientOrganizationId = readStringField(body, "clientOrganizationId");
  if (!agencyOrganizationId || !clientOrganizationId) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "agencyOrganizationId and clientOrganizationId are required."),
    );
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<AgencyClientAssignmentViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const agency = await ctx.repos.organizations.findById(agencyOrganizationId);
        if (!agency || agency.type !== "AGENCY") {
          throw new CommandAbortError("VALIDATION_FAILED", "agencyOrganizationId must be an existing AGENCY organization.");
        }
        const client = await ctx.repos.organizations.findById(clientOrganizationId);
        if (!client || client.type !== "CLIENT") {
          throw new CommandAbortError("VALIDATION_FAILED", "clientOrganizationId must be an existing CLIENT organization.");
        }
        const already = await ctx.repos.agencyClientAssignments.isAuthorized(
          agencyOrganizationId,
          clientOrganizationId,
        );
        if (already) {
          throw new CommandAbortError("CONFLICT", "That agency is already assigned to that client.");
        }

        const assignment = await ctx.repos.agencyClientAssignments.assign({
          agencyOrganizationId,
          clientOrganizationId,
          assignedByUserId: ctx.actor.userId,
        });
        const view: AgencyClientAssignmentViewV1 = {
          id: assignment.id,
          agencyOrganizationId: assignment.agencyOrganizationId,
          clientOrganizationId: assignment.clientOrganizationId,
          status: assignment.status,
          assignedAt: assignment.assignedAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: assignment.clientOrganizationId,
            targetType: "agency_client_assignment",
            targetId: assignment.id,
            metadata: { agencyOrganizationId: assignment.agencyOrganizationId },
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
