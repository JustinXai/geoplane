/**
 * POST /api/opportunities/[id]/reviews — records a human-review decision on an Opportunity's
 * validation (GEO chain item 6, the human-review gate).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * NEVER auto-approved (SYSTEM_INVARIANTS_V1.md "no silently-approved state"): the only path to an
 * APPROVED decision is an explicit `decision: "CONFIRMED"`; there is no default/omission path.
 * CHANGES_REQUESTED / REJECTED require a note. The decision is append-only — a changed mind is a
 * new decision, never a mutation.
 *
 * Reviewer identity comes from the authenticated session (a real `user` row — the human making the
 * decision), never from request input: the human_review_decision.reviewer_user_id is a real
 * "user" FK, and identity is always server-derived (SYSTEM_INVARIANTS_V1.md).
 *
 * `[id]` is the Opportunity id. Server-side tenant resolution: the tenant is read from the
 * persisted Opportunity, never from the body; the reviewed OpportunityValidation is verified to
 * belong to that opportunity and tenant. Cross-tenant -> 403 + DENIED. Idempotency-Key makes a
 * retried decision replay the first result.
 */
import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../runtime/auth/runtime-context.js";
import type { HumanReviewDecision } from "../../../../../contracts/geo-business/entities.js";
import type { HumanReviewDecisionViewV1 } from "../../../../../runtime/commands/geo-dto.js";
import {
  buildGeoAuthorizationContext,
  createGeoCommandRuntime,
  invokeDomain,
} from "../../../../../runtime/commands/geo-command-runtime.js";
import {
  denyIfCrossTenant,
  isResponse,
  requireSession,
} from "../../../../../runtime/commands/geo-command-http.js";
import { readString } from "../../../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "human_review.command.decide";

type ReviewDecisionInput = "CONFIRMED" | "CHANGES_REQUESTED" | "REJECTED";

function asDecision(value: string): ReviewDecisionInput | null {
  return value === "CONFIRMED" || value === "CHANGES_REQUESTED" || value === "REJECTED"
    ? value
    : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { id } = await context.params;

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  // Server-side tenant resolution: read the persisted opportunity's tenant, never trust the body.
  const opportunity = await createGeoCommandRuntime(rt.db).repos.opportunities.getById(id);
  if (!opportunity) return toHttpResponse(apiErr("NOT_FOUND", "Opportunity not found."));
  const tenant = {
    clientOrganizationId: opportunity.clientOrganizationId,
    projectId: opportunity.projectId,
  };

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "HumanReviewDecision");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const opportunityValidationId = readString(body, "opportunityValidationId");
  const decisionRaw = readString(body, "decision");
  const note = readString(body, "note");
  // The reviewer is the authenticated human — a real user, resolved server-side, never trusted from
  // the body. There is no path to a decision without one (human review is never auto-approved).
  const reviewerId = actor.userId;
  if (!opportunityValidationId || !decisionRaw) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "opportunityValidationId and an explicit decision are required (human review is never auto-approved).",
      ),
    );
  }
  const decision = asDecision(decisionRaw);
  if (!decision) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "decision must be CONFIRMED, CHANGES_REQUESTED or REJECTED."),
    );
  }
  if (decision !== "CONFIRMED" && !note) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "a note is required for a CHANGES_REQUESTED or REJECTED decision."),
    );
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<HumanReviewDecisionViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const validation = await geo.repos.opportunityValidations.getById(opportunityValidationId);
        if (
          !validation ||
          validation.opportunityId !== opportunity.id ||
          validation.clientOrganizationId !== tenant.clientOrganizationId ||
          validation.projectId !== tenant.projectId
        ) {
          throw new CommandAbortError(
            "NOT_FOUND",
            "Opportunity validation not found for this opportunity.",
          );
        }

        let recorded: HumanReviewDecision;
        if (decision === "CONFIRMED") {
          recorded = await invokeDomain(() =>
            geo.services.humanReview.confirm(authContext, validation, reviewerId),
          );
        } else if (decision === "CHANGES_REQUESTED") {
          recorded = await invokeDomain(() =>
            geo.services.humanReview.requestChanges(authContext, validation, reviewerId, note!),
          );
        } else {
          recorded = await invokeDomain(() =>
            geo.services.humanReview.reject(authContext, validation, reviewerId, note!),
          );
        }

        const view: HumanReviewDecisionViewV1 = {
          id: recorded.id,
          clientOrganizationId: recorded.clientOrganizationId,
          projectId: recorded.projectId,
          opportunityId: recorded.opportunityId,
          opportunityValidationId: recorded.opportunityValidationId,
          status: recorded.status,
          reviewerId: recorded.reviewerId,
          decidedAt: recorded.decidedAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "HumanReviewDecision",
            targetId: recorded.id,
            metadata: { opportunityId: opportunity.id, decision: recorded.status },
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
