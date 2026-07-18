/**
 * POST /api/projects/[projectId]/invitations — invite a Client Owner to the project's client
 * organization. Persists a PENDING invitation storing ONLY the SHA-256 token hash (never the raw
 * token — SECURITY_IMPORT_REPORT.md / entities.ts Invitation.tokenHash).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 1). This is a NEW file at a NEW path under
 * src/app/api/projects/** (no existing route.ts here), which this lane is permitted to add.
 *
 * The invited organization is derived SERVER-SIDE from the project (project.clientOrganizationId),
 * never from the body. Authorization to invite:
 *   - PLATFORM_SUPER_ADMIN -> any project;
 *   - AGENCY_*             -> only a client it has an ACTIVE assignment to;
 *   - CLIENT_OWNER         -> only its own client org.
 * A wrong-role / cross-tenant attempt returns 403 FORBIDDEN + a DENIED audit event. Idempotency-Key
 * (header/body) makes a retried invite persist ONE invitation.
 */
import { randomBytes } from "node:crypto";
import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../runtime/auth/runtime-context.js";
import {
  DEFAULT_INVITATION_TTL_MS,
  hashInvitationToken,
} from "../../../../../contracts/tenancy/invitations.js";
import type { InvitationViewV1 } from "../../../../../runtime/commands/dto.js";
import {
  readIdempotencyKey,
  readStringField,
  recordDeniedCommand,
  runWriteCommand,
} from "../../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "project.invitation.create";

/** The Client Owner an inviter may reach for `clientOrganizationId`, purely from session facts. */
function canInviteForClientOrg(
  session: { role: string; activeClientOrganizationId: string | null; organizationId: string; assignedClientOrganizationIds: readonly string[] },
  clientOrganizationId: string,
): boolean {
  switch (session.role) {
    case "PLATFORM_SUPER_ADMIN":
      return true;
    case "CLIENT_OWNER":
      return (session.activeClientOrganizationId ?? session.organizationId) === clientOrganizationId;
    case "AGENCY_OWNER":
    case "AGENCY_OPERATOR":
      return session.assignedClientOrganizationIds.includes(clientOrganizationId);
    default:
      return false;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const { projectId } = await context.params;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const project = await rt.repos.projects.findById(projectId);
  if (!project) {
    return toHttpResponse(apiErr("NOT_FOUND", "Project not found."));
  }
  const clientOrganizationId = project.clientOrganizationId;

  if (!canInviteForClientOrg(session, clientOrganizationId)) {
    await recordDeniedCommand(rt.db, actor, ACTION, {
      clientOrganizationId,
      projectId,
      targetType: "invitation",
    });
    return toHttpResponse(
      apiErr("FORBIDDEN", "Not authorized to invite a client owner for this project."),
    );
  }

  const body = await readJsonBody(request);
  const invitedEmail = readStringField(body, "invitedEmail");
  if (!invitedEmail) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "invitedEmail is required."));
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  const { dto } = await runWriteCommand<InvitationViewV1>({
    db: rt.db,
    actor,
    action: ACTION,
    idempotencyKey,
    perform: async (ctx) => {
      // A cryptographically random one-time token; ONLY its hash is ever persisted. The raw token
      // is discarded here (out-of-band delivery is a later checkpoint's concern) and never returned.
      const rawToken = randomBytes(32).toString("hex");
      const invitation = await ctx.repos.invitations.create({
        organizationId: clientOrganizationId,
        invitedEmail,
        role: "CLIENT_OWNER",
        tokenHash: hashInvitationToken(rawToken),
        createdByUserId: ctx.actor.userId,
        expiresAt: new Date(ctx.now.getTime() + DEFAULT_INVITATION_TTL_MS),
      });

      const view: InvitationViewV1 = {
        id: invitation.id,
        organizationId: invitation.organizationId,
        projectId,
        invitedEmail: invitation.invitedEmail,
        role: invitation.role,
        status: invitation.status,
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
      };
      return {
        dto: view,
        audit: {
          clientOrganizationId,
          projectId,
          targetType: "invitation",
          targetId: invitation.id,
          metadata: { invitedEmail },
        },
      };
    },
  });

  return toHttpResponse(apiOk(dto));
}
