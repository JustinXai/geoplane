/**
 * POST /api/publication-receipts — records that a specific channel of a DistributionPlan was
 * actually published to, by a real (never automatic) actor (GEO chain item 14).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * No automatic publication under any circumstance (SYSTEM_INVARIANTS_V1.md "Publication"): the
 * actor comes exclusively from the verified signed session; request-body actor fields are ignored.
 * The channel must be one the DistributionPlan actually selected.
 *
 * Server-side tenant resolution: the tenant is read from the referenced DistributionPlan, never the
 * body. Cross-tenant -> 403 + DENIED. Idempotency-Key makes a retried record replay the first result.
 */
import { apiErr, apiOk } from "../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../runtime/auth/runtime-context.js";
import type { PublicationReceiptViewV1 } from "../../../runtime/commands/geo-dto.js";
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
import { readString } from "../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "publication_receipt.command.create";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const body = await readJsonBody(request);
  const distributionPlanId = readString(body, "distributionPlanId");
  const channelId = readString(body, "channelId");
  if (!distributionPlanId || !channelId) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "distributionPlanId and channelId are required."),
    );
  }

  // Server-side tenant resolution: read the referenced plan's tenant, never trust the body.
  const planForTenant = await createGeoCommandRuntime(rt.db).repos.distributionPlans.getById(
    distributionPlanId,
  );
  if (!planForTenant) {
    return toHttpResponse(apiErr("NOT_FOUND", "Distribution plan not found."));
  }
  const tenant = {
    clientOrganizationId: planForTenant.clientOrganizationId,
    projectId: planForTenant.projectId,
  };
  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "PublicationReceipt");
  if (denied) return denied;

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<PublicationReceiptViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const plan = await geo.repos.distributionPlans.getById(distributionPlanId);
        if (!plan) throw new CommandAbortError("NOT_FOUND", "Distribution plan not found.");

        // The frozen constructor rejects an automatic/system actor and an off-plan channel;
        // invokeDomain maps those to 422 VALIDATION_FAILED.
        const receipt = await invokeDomain(() =>
          geo.services.delivery.recordPublicationReceipt(
            authContext,
            plan,
            channelId,
            session.userId,
          ),
        );
        const view: PublicationReceiptViewV1 = {
          id: receipt.id,
          clientOrganizationId: receipt.clientOrganizationId,
          projectId: receipt.projectId,
          distributionPlanId: receipt.distributionPlanId,
          channelId: receipt.channelId,
          publishedByActorId: receipt.publishedByActorId,
          publishedAt: receipt.publishedAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: receipt.clientOrganizationId,
            projectId: receipt.projectId,
            targetType: "PublicationReceipt",
            targetId: receipt.id,
            metadata: { channelId: receipt.channelId },
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
