/**
 * POST /api/commands/projects/[projectId]/deliveries — records a manual delivery receipt
 * for approved content.
 *
 * This route implements the "Manual Delivery Receipt" step in the content delivery chain:
 *   - Given a DistributionPlan with selected channels + operator confirmation
 *   - Creates a PublicationReceipt for each channel being delivered
 *   - Records the delivery with operator evidence
 *
 * This is for cases where an operator manually publishes content (e.g., copying to
 * a platform manually) and needs to record the delivery as evidence.
 *
 * Server-side tenant resolution: the client org is the project's owning client org,
 * from the session's grants — never a body value. Cross-tenant -> 403 + DENIED audit.
 * Idempotency-Key makes a retried create yield ONE delivery record per channel.
 */
import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../../runtime/auth/runtime-context.js";
import type { PublicationReceiptViewV1 } from "../../../../../../runtime/commands/geo-dto.js";
import {
  buildGeoAuthorizationContext,
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
import type { PublicationReceipt } from "../../../../../../contracts/geo-business/entities.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "manual_delivery.receipt.create";

interface DeliveryReceiptInput {
  distributionPlanId: string;
  channelId: string;
  operatorUserId: string;
  externalUrl?: string;
  evidenceNote?: string;
  failureReason?: string;
  deliveryStatus: "COMPLETED" | "FAILED" | "PENDING";
  notes?: string;
}

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

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "delivery_receipt");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const distributionPlanId = readString(body, "distributionPlanId");
  const channelId = readString(body, "channelId");
  const operatorUserId = readString(body, "operatorUserId");
  const deliveryStatus = readString(body, "deliveryStatus") as DeliveryReceiptInput["deliveryStatus"] | undefined;
  const externalUrl = readString(body, "externalUrl");
  const evidenceNote = readString(body, "evidenceNote");
  const failureReason = readString(body, "failureReason");
  const notes = readString(body, "notes");

  if (!distributionPlanId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "distributionPlanId is required."));
  }
  if (!channelId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "channelId is required."));
  }
  if (!operatorUserId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "operatorUserId is required."));
  }
  if (!deliveryStatus || !["COMPLETED", "FAILED", "PENDING"].includes(deliveryStatus)) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "deliveryStatus must be COMPLETED, FAILED, or PENDING."));
  }

  // For FAILED deliveries, failureReason is required
  if (deliveryStatus === "FAILED" && !failureReason) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "failureReason is required when deliveryStatus is FAILED."));
  }

  // Validate that operatorUserId is not a system/automatic actor
  const forbiddenActors = ["system", "auto", "automated", "automatic", ""];
  if (forbiddenActors.includes(operatorUserId.trim().toLowerCase())) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "operatorUserId cannot be a system/automatic actor."),
    );
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<PublicationReceiptViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);

        // Fetch the distribution plan
        const plan = await geo.repos.distributionPlans.getById(distributionPlanId);
        if (!plan) {
          throw new CommandAbortError("NOT_FOUND", "DistributionPlan not found.");
        }
        if (plan.clientOrganizationId !== tenant.clientOrganizationId) {
          throw new CommandAbortError("FORBIDDEN", "DistributionPlan does not belong to this tenant.");
        }

        // Verify channelId is in the distribution plan
        if (!plan.channelIds.includes(channelId)) {
          throw new CommandAbortError(
            "VALIDATION_FAILED",
            `Channel "${channelId}" is not in the DistributionPlan's selected channels.`,
          );
        }

        const authContext = buildGeoAuthorizationContext(session);

        // Record the publication receipt
        const receipt = await geo.services.delivery.recordPublicationReceipt(
          authContext,
          plan,
          channelId,
          operatorUserId,
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
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "publication_receipt",
            targetId: receipt.id,
            metadata: {
              distributionPlanId,
              channelId,
              deliveryStatus,
              externalUrl: externalUrl || null,
              evidenceNote: evidenceNote || null,
              failureReason: failureReason || null,
              notes: notes || null,
            },
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
