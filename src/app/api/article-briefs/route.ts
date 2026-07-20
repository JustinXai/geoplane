/**
 * GET /api/article-briefs — lists all ArticleBriefs for the authenticated client
 * (server-side tenant resolution from session; body carries no org id).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 */

/**
 * POST /api/article-briefs — builds the planning brief from an OpportunityFamily (GEO chain item 8).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * Every authorizing HumanReviewDecision id from the family is carried into the brief's planning
 * context by the frozen ArticleBriefService, so the brief stays auditable back to the approvals
 * that authorized it. A brief is immutable once created — a revised brief is a new brief.
 *
 * Server-side tenant resolution: the tenant is read from the referenced OpportunityFamily (which
 * carries the server-set client org), never from the body. Cross-tenant -> 403 + DENIED.
 * Idempotency-Key makes a retried create yield ONE brief.
 */
import { apiErr, apiOk } from "../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../runtime/auth/runtime-context.js";
import type { ArticleBriefPlanningContextV1 } from "../../../contracts/geo-business/entities.js";
import type { ArticleBriefViewV1 } from "../../../runtime/commands/geo-dto.js";
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
import { readOptionalStringArray, readString, readStringArray } from "../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  try {
    const geo = createGeoCommandRuntime(rt.db);
    const briefs = await geo.repos.articleBriefs.listByOrganization(session.organizationId);
    const views: ArticleBriefViewV1[] = briefs.map((b) => ({
      id: b.id, clientOrganizationId: b.clientOrganizationId, projectId: b.projectId,
      opportunityFamilyId: b.opportunityFamilyId, workingTitle: b.workingTitle,
      outline: b.outline, riskLevel: b.planningContext.riskLevel, createdAt: b.createdAt,
    }));
    return toHttpResponse(apiOk(views));
  } catch (err) {
    console.error("GET /api/article-briefs failed:", err);
    return toHttpResponse(apiErr("INTERNAL_ERROR", "Failed to load article briefs."));
  }
}

const ACTION = "article_brief.command.create";

type RiskLevel = ArticleBriefPlanningContextV1["riskLevel"];

function asRiskLevel(value: string): RiskLevel | null {
  return value === "STANDARD" || value === "ESCALATED_FOR_HUMAN_REVIEW" ? value : null;
}

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const body = await readJsonBody(request);
  const opportunityFamilyId = readString(body, "opportunityFamilyId");
  const workingTitle = readString(body, "workingTitle");
  const riskLevelRaw = readString(body, "riskLevel");
  const outline = readOptionalStringArray(body, "outline");
  const targetKeywords = readStringArray(body, "targetKeywords");
  if (!opportunityFamilyId || !workingTitle || !riskLevelRaw || outline === null) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "opportunityFamilyId, workingTitle, riskLevel and a valid outline[] are required.",
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

  // Server-side tenant resolution: read the referenced family's tenant, never trust the body.
  const familyForTenant = await createGeoCommandRuntime(rt.db).repos.opportunityFamilies.getById(
    opportunityFamilyId,
  );
  if (!familyForTenant) {
    return toHttpResponse(apiErr("NOT_FOUND", "Opportunity family not found."));
  }
  const tenant = {
    clientOrganizationId: familyForTenant.clientOrganizationId,
    projectId: familyForTenant.projectId,
  };
  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "ArticleBrief");
  if (denied) return denied;

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<ArticleBriefViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const family = await geo.repos.opportunityFamilies.getById(opportunityFamilyId);
        if (!family) {
          throw new CommandAbortError("NOT_FOUND", "Opportunity family not found.");
        }

        // Pre-flight authorization ran against the URL-less tenant; enforce the family's own tenant.
        const brief = await invokeDomain(() =>
          geo.services.brief.createBrief(authContext, {
            family,
            workingTitle,
            outline,
            targetKeywords: [targetKeywords[0]!, ...targetKeywords.slice(1)],
            riskLevel,
          }),
        );
        const view: ArticleBriefViewV1 = {
          id: brief.id,
          clientOrganizationId: brief.clientOrganizationId,
          projectId: brief.projectId,
          opportunityFamilyId: brief.opportunityFamilyId,
          workingTitle: brief.workingTitle,
          outline: brief.outline,
          riskLevel: brief.planningContext.riskLevel,
          createdAt: brief.createdAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: brief.clientOrganizationId,
            projectId: brief.projectId,
            targetType: "ArticleBrief",
            targetId: brief.id,
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
