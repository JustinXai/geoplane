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
 *
 * CLIENT_REVIEW_RUNTIME_V1 (Agent C2): the validation this decision keys on is carried by the
 * client-safe OPAQUE `reviewReferenceCode` (SAFE_REVIEW_REFERENCE_V1) — the server VERIFIES + decodes
 * it back to the internal validation id and rejects a forged/tampered code. A raw `opportunityValidationId`
 * is still accepted for internal/back-compat callers. The client offers the frozen three-state decision
 * (CONFIRMED / CHANGES_REQUESTED / DEFERRED); DEFERRED maps to a held (REJECTED) human-review outcome
 * (never approved), CONFIRMED to an APPROVED one. An optional `reviewVersion` gives optimistic
 * concurrency: a stale version (a newer decision already exists) -> 409 CONFLICT with no write.
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
import { readInteger, readString } from "../../../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../../runtime/commands/runtime-context.js";
import { decodeReviewReferenceCode } from "../../../../../runtime/geo/review-reference.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "human_review.command.decide";

/**
 * The decisions the command accepts. The client three-state (CONFIRMED / CHANGES_REQUESTED /
 * DEFERRED) is the primary surface; REJECTED is retained for internal/back-compat callers. Only
 * CONFIRMED yields an APPROVED human-review outcome — DEFERRED and REJECTED both record a held
 * (REJECTED) decision (never auto-approved), and every non-CONFIRMED decision requires a note.
 */
type ReviewDecisionInput = "CONFIRMED" | "CHANGES_REQUESTED" | "DEFERRED" | "REJECTED";

function asDecision(value: string): ReviewDecisionInput | null {
  return value === "CONFIRMED" ||
    value === "CHANGES_REQUESTED" ||
    value === "DEFERRED" ||
    value === "REJECTED"
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
  const reviewReferenceCode = readString(body, "reviewReferenceCode");
  const rawValidationId = readString(body, "opportunityValidationId");
  const decisionRaw = readString(body, "decision");
  const note = readString(body, "note");
  const reviewVersion = readInteger(body, "reviewVersion");
  // The reviewer is the authenticated human — a real user, resolved server-side, never trusted from
  // the body. There is no path to a decision without one (human review is never auto-approved).
  const reviewerId = actor.userId;

  // Resolve the validation id: the OPAQUE reviewReferenceCode is preferred (verified + decoded);
  // a tampered/forged code is rejected outright. A raw opportunityValidationId is the internal
  // back-compat fallback. Never falls through to a default id.
  let opportunityValidationId: string | null;
  if (reviewReferenceCode) {
    opportunityValidationId = decodeReviewReferenceCode(reviewReferenceCode);
    if (!opportunityValidationId) {
      return toHttpResponse(
        apiErr("VALIDATION_FAILED", "The review reference is invalid or has been tampered with."),
      );
    }
  } else {
    opportunityValidationId = rawValidationId;
  }

  if (!opportunityValidationId || !decisionRaw) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "a review reference (or opportunityValidationId) and an explicit decision are required (human review is never auto-approved).",
      ),
    );
  }
  const decision = asDecision(decisionRaw);
  if (!decision) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "decision must be CONFIRMED, CHANGES_REQUESTED or DEFERRED."),
    );
  }
  if (decision !== "CONFIRMED" && !note) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "a note is required for a CHANGES_REQUESTED or DEFERRED decision."),
    );
  }
  if (reviewVersion !== null && reviewVersion < 0) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "reviewVersion must be a non-negative integer."));
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

        // Optimistic concurrency: when the client carries the version it read, re-check it against
        // the decisions recorded so far for THIS validation (inside the transaction, so no TOCTOU
        // race). A stale version (a newer decision landed meanwhile) -> 409 CONFLICT, no write.
        if (reviewVersion !== null) {
          const priorDecisions = await geo.repos.humanReviews.listByScope(tenant);
          const currentVersion = priorDecisions.filter(
            (d) => d.opportunityValidationId === validation.id,
          ).length;
          if (currentVersion !== reviewVersion) {
            throw new CommandAbortError(
              "CONFLICT",
              "This review is out of date (a newer decision already exists). Refresh and retry.",
            );
          }
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
          // DEFERRED (client "暂不处理") and legacy REJECTED both record a held, non-approved decision.
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
            metadata: {
              opportunityId: opportunity.id,
              decision: recorded.status,
              clientReviewDecision: decision,
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
