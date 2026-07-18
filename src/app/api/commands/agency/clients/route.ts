/**
 * POST /api/commands/agency/clients — an AGENCY_OWNER provisions a new CLIENT organization it will
 * manage, creating both the CLIENT org and the ACTIVE agency_client_assignment that grants its own
 * agency access, atomically.
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 1).
 *
 * Route location note: the requested path was POST /api/agency/clients, but a GET route.ts already
 * exists at src/app/api/agency/clients/ and the Next.js App Router allows only ONE route.ts per
 * path (all method handlers share that file). This lane must NOT modify that existing file, so the
 * agency-owner command is mounted here, under this lane's exclusive /api/commands/** namespace.
 *
 * The agency organization is ALWAYS the caller's own session.organizationId — never read from the
 * body (SYSTEM_INVARIANTS_V1.md: server-side tenant resolution). Non-AGENCY_OWNER callers get 403 +
 * a DENIED audit event. Idempotency-Key (header/body) makes a retried create yield ONE client org.
 */
import { randomUUID } from "node:crypto";
import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../runtime/auth/runtime-context.js";
import type { AgencyClientProvisionViewV1 } from "../../../../../runtime/commands/dto.js";
import {
  readIdempotencyKey,
  readStringField,
  recordDeniedCommand,
  runWriteCommand,
} from "../../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "agency.client.provision";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const actor = { userId: session.userId, organizationId: session.organizationId };

  // Server-derived agency identity: the caller's own organization, from the session — never body.
  const agencyOrganizationId = session.organizationId;

  if (session.role !== "AGENCY_OWNER") {
    await recordDeniedCommand(rt.db, actor, ACTION, {
      targetType: "organization",
      metadata: { agencyOrganizationId },
    });
    return toHttpResponse(
      apiErr("FORBIDDEN", "Only an agency owner may provision a managed client."),
    );
  }

  const body = await readJsonBody(request);
  const displayName = readStringField(body, "displayName");
  if (!displayName) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "displayName is required."));
  }

  const idempotencyKey = readIdempotencyKey(request, body);
  const orgIdempotencyKey = idempotencyKey
    ? `${ACTION}:${actor.userId}:${idempotencyKey}`
    : randomUUID();

  const { dto } = await runWriteCommand<AgencyClientProvisionViewV1>({
    db: rt.db,
    actor,
    action: ACTION,
    idempotencyKey,
    perform: async (ctx) => {
      const client = await ctx.repos.organizations.createIdempotent({
        type: "CLIENT",
        displayName,
        idempotencyKey: orgIdempotencyKey,
        createdByUserId: ctx.actor.userId,
      });
      const assignment = await ctx.repos.agencyClientAssignments.assign({
        agencyOrganizationId,
        clientOrganizationId: client.id,
        assignedByUserId: ctx.actor.userId,
      });

      const view: AgencyClientProvisionViewV1 = {
        client: {
          id: client.id,
          type: client.type,
          displayName: client.displayName,
          status: client.status,
          createdAt: client.createdAt,
        },
        assignment: {
          id: assignment.id,
          agencyOrganizationId: assignment.agencyOrganizationId,
          clientOrganizationId: assignment.clientOrganizationId,
          status: assignment.status,
          assignedAt: assignment.assignedAt,
        },
      };
      return {
        dto: view,
        audit: {
          clientOrganizationId: client.id,
          targetType: "organization",
          targetId: client.id,
          metadata: { agencyOrganizationId, assignmentId: assignment.id },
        },
      };
    },
  });

  return toHttpResponse(apiOk(dto));
}
