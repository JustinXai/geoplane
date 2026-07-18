/**
 * POST /api/distribution-plans — records the explicit, human-chosen set of channels to distribute a
 * ChannelNeutralContentPackage to (GEO chain item 13).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * A human selects the channels (SYSTEM_INVARIANTS_V1.md "Publication"): `channelIds` must be a
 * non-empty, explicitly-supplied list and `selectedByActorId` a real actor — there is no default
 * channel and no "ready with zero explicit action" plan. An empty channel list is rejected 422.
 *
 * Server-side tenant resolution: the tenant is read from the referenced ChannelNeutralContentPackage,
 * never the body. Cross-tenant -> 403 + DENIED. Idempotency-Key makes a retried create yield ONE plan.
 */
import { apiErr, apiOk } from "../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../runtime/auth/runtime-context.js";
import type { DistributionPlanViewV1 } from "../../../runtime/commands/geo-dto.js";
import {
  buildGeoAuthorizationContext,
  createGeoCommandRuntime,
  invokeDomain,
} from "../../../runtime/commands/geo-command-runtime.js";
import {
  denyIfCrossTenant,
  isResponse,
  requireSession,
} from "../../../runtime/commands/geo-command-http.js";
import { readString, readStringArray } from "../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "distribution_plan.command.create";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const body = await readJsonBody(request);
  const channelNeutralContentPackageId = readString(body, "channelNeutralContentPackageId");
  const selectedByActorId = readString(body, "selectedByActorId");
  const channelIds = readStringArray(body, "channelIds");
  if (!channelNeutralContentPackageId || !selectedByActorId) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "channelNeutralContentPackageId and selectedByActorId are required.",
      ),
    );
  }
  if (!channelIds || channelIds.length === 0) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "channelIds must be a non-empty list — a human must explicitly select the channels.",
      ),
    );
  }

  // Server-side tenant resolution: read the referenced package's tenant, never trust the body.
  const cncForTenant = await createGeoCommandRuntime(rt.db).repos.channelNeutralPackages.getById(
    channelNeutralContentPackageId,
  );
  if (!cncForTenant) {
    return toHttpResponse(apiErr("NOT_FOUND", "Channel-neutral content package not found."));
  }
  const tenant = {
    clientOrganizationId: cncForTenant.clientOrganizationId,
    projectId: cncForTenant.projectId,
  };
  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "DistributionPlan");
  if (denied) return denied;

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<DistributionPlanViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const cnc = await geo.repos.channelNeutralPackages.getById(channelNeutralContentPackageId);
        if (!cnc) {
          throw new CommandAbortError("NOT_FOUND", "Channel-neutral content package not found.");
        }

        const plan = await invokeDomain(() =>
          geo.services.distribution.createDistributionPlan(authContext, {
            channelNeutralPackage: cnc,
            channelIds: [channelIds[0]!, ...channelIds.slice(1)],
            selectedByActorId,
          }),
        );
        const view: DistributionPlanViewV1 = {
          id: plan.id,
          clientOrganizationId: plan.clientOrganizationId,
          projectId: plan.projectId,
          channelNeutralContentPackageId: plan.channelNeutralContentPackageId,
          channelIds: plan.channelIds,
          selectedByActorId: plan.selectedByActorId,
          selectedAt: plan.selectedAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: plan.clientOrganizationId,
            projectId: plan.projectId,
            targetType: "DistributionPlan",
            targetId: plan.id,
            metadata: { channelCount: plan.channelIds.length },
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
