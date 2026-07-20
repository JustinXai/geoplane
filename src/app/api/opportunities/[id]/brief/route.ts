/**
 * POST /api/opportunities/[id]/brief — atomically bridges a knowledge-driven Opportunity
 * all the way to an ArticleBrief (GEO chain items 5-8 in one transaction).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2, opportunity content bridge).
 *
 * This route bridges the "knowledge-first" opportunity creation flow to the content
 * production flow. It accepts a knowledge-opportunity id and produces a brief by:
 *
 *   1. Validating the opportunity against the project's IndustryProfile.
 *   2. Recording an APPROVED HumanReviewDecision (server-resolved reviewer from session).
 *   3. Creating an OpportunityFamily containing the approved opportunity.
 *   4. Creating an ArticleBrief from the family.
 *
 * All four steps run inside ONE write transaction — a failure anywhere rolls back everything.
 * Human review is never auto-approved: the reviewerId comes from the authenticated session, never
 * from request input.
 *
 * Server-side tenant resolution: the tenant is read from the persisted Opportunity, never the
 * body. Cross-tenant -> 403 + DENIED. Idempotency-Key makes a retried create yield ONE brief.
 */
import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../runtime/auth/runtime-context.js";
import type { ArticleBriefPlanningContextV1 } from "../../../../../contracts/geo-business/entities.js";
import type { ArticleBriefViewV1 } from "../../../../../runtime/commands/geo-dto.js";
import {
  buildGeoAuthorizationContext,
  createGeoCommandRuntime,
} from "../../../../../runtime/commands/geo-command-runtime.js";
import {
  denyIfCrossTenant,
  isResponse,
  requireSession,
} from "../../../../../runtime/commands/geo-command-http.js";
import {
  readOptionalStringArray,
  readString,
  readStringArray,
} from "../../../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "article_brief.command.create_from_opportunity";

type RiskLevel = ArticleBriefPlanningContextV1["riskLevel"];

function asRiskLevel(value: string): RiskLevel | null {
  return value === "STANDARD" || value === "ESCALATED_FOR_HUMAN_REVIEW" ? value : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { id: opportunityId } = await context.params;

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  // Server-side tenant resolution: read the persisted opportunity's tenant, never trust the body.
  const geoRt = createGeoCommandRuntime(rt.db);
  const opportunity = await geoRt.repos.opportunities.getById(opportunityId);
  if (!opportunity) return toHttpResponse(apiErr("NOT_FOUND", "Opportunity not found."));
  const tenant = {
    clientOrganizationId: opportunity.clientOrganizationId,
    projectId: opportunity.projectId,
  };
  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "ArticleBrief");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const workingTitle = readString(body, "workingTitle");
  const riskLevelRaw = readString(body, "riskLevel");
  const outline = readOptionalStringArray(body, "outline");
  const targetKeywords = readStringArray(body, "targetKeywords");
  if (!workingTitle || !riskLevelRaw || outline === null) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "workingTitle, riskLevel, and a valid outline[] are required.",
      ),
    );
  }
  const riskLevel = asRiskLevel(riskLevelRaw);
  if (!riskLevel) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "riskLevel must be STANDARD or ESCALATED_FOR_HUMAN_REVIEW."),
    );
  }
  if (!targetKeywords || targetKeywords.length === 0) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "targetKeywords must be a non-empty array of keywords."),
    );
  }

  // Resolve the IndustryProfile for this project.
  const industryProfiles = await rt.db.query<{ id: string; validation_gate_level: string }>(
    `SELECT id, validation_gate_level FROM industry_profile
     WHERE client_organization_id = $1 AND project_id = $2
     LIMIT 1`,
    [tenant.clientOrganizationId, tenant.projectId],
  );
  const profileRow = industryProfiles.rows[0];
  if (!profileRow) {
    return toHttpResponse(
      apiErr(
        "NOT_FOUND",
        "IndustryProfile not found for this project. Please contact platform ops to configure industry rules.",
      ),
    );
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  // The reviewer is the authenticated human — server-resolved, never from the body.
  const reviewerId = actor.userId;

  try {
    const { dto } = await runWriteCommand<ArticleBriefViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        // Re-read inside the transaction to ensure we still have the opportunity.
        const opp = await geo.repos.opportunities.getById(opportunityId);
        if (!opp) {
          throw new CommandAbortError("NOT_FOUND", "Opportunity not found.");
        }

        // Future enhancement: check for existing brief for this opportunity for idempotent return.
        const result = await geo.services.opportunityToBrief.createBriefFromOpportunity(
          authContext,
          {
            opportunity: opp,
            industryProfile: {
              id: profileRow.id,
              validationGateLevel: profileRow.validation_gate_level as
                | "PLATFORM_WIDE_GATE"
                | "INDUSTRY_VERTICAL_GATE",
            },
            reviewerId,
            workingTitle,
            outline,
            targetKeywords: [targetKeywords[0]!, ...targetKeywords.slice(1)],
            riskLevel,
          },
        );

        const view: ArticleBriefViewV1 = {
          id: result.brief.id,
          clientOrganizationId: result.brief.clientOrganizationId,
          projectId: result.brief.projectId,
          opportunityFamilyId: result.brief.opportunityFamilyId,
          workingTitle: result.brief.workingTitle,
          outline: result.brief.outline,
          riskLevel: result.brief.planningContext.riskLevel,
          createdAt: result.brief.createdAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: result.brief.clientOrganizationId,
            projectId: result.brief.projectId,
            targetType: "ArticleBrief",
            targetId: result.brief.id,
            metadata: {
              opportunityId: opp.id,
              opportunityFamilyId: result.family.id,
              humanReviewDecisionId: result.decision.id,
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
