/**
 * POST /api/ops/clients — a PLATFORM_SUPER_ADMIN creates a new CLIENT organization.
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 1). Actor derived from the session only; non-platform
 * callers get 403 FORBIDDEN + a DENIED audit event. Idempotency-Key (header/body) makes a retried
 * create yield ONE organization.
 */
import { randomUUID } from "node:crypto";
import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import type { OrganizationSummaryV1 } from "../../../../runtime/commands/dto.js";
import {
  readIdempotencyKey,
  readStringField,
  recordDeniedCommand,
  runWriteCommand,
} from "../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "ops.client.create";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const actor = { userId: session.userId, organizationId: session.organizationId };

  if (session.role !== "PLATFORM_SUPER_ADMIN") {
    await recordDeniedCommand(rt.db, actor, ACTION, { targetType: "organization" });
    return toHttpResponse(
      apiErr("FORBIDDEN", "Only a platform super admin may create clients."),
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

  const { dto } = await runWriteCommand<OrganizationSummaryV1>({
    db: rt.db,
    actor,
    action: ACTION,
    idempotencyKey,
    perform: async (ctx) => {
      const org = await ctx.repos.organizations.createIdempotent({
        type: "CLIENT",
        displayName,
        idempotencyKey: orgIdempotencyKey,
        createdByUserId: ctx.actor.userId,
      });
      const view: OrganizationSummaryV1 = {
        id: org.id,
        type: org.type,
        displayName: org.displayName,
        status: org.status,
        createdAt: org.createdAt,
      };
      return { dto: view, audit: { clientOrganizationId: org.id, targetType: "organization", targetId: org.id } };
    },
  });

  return toHttpResponse(apiOk(dto));
}
