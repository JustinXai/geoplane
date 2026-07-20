/**
 * GET /api/opportunity-families — lists all OpportunityFamilies for the authenticated client
 * (server-side tenant resolution from session; body carries no org id).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 */

/**
 * POST /api/opportunity-families — groups one or more APPROVED Opportunities into the unit that
 * becomes a single piece of content (GEO chain item 7).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * No Opportunity enters a family without an APPROVED human-review decision: each member's
 * authorizing decision is re-verified (exists, same tenant, status APPROVED, authorizes that
 * opportunity) by the frozen OpportunityFamilyService. The route stamps each member's
 * authorizingReviewDecisionStatus to the literal "APPROVED" (the service rejects it if the real
 * decision is not).
 *
 * Server-side tenant resolution: `projectId` names the target project; its owning client org is
 * resolved from the session's grants — the body carries no client org id. Cross-tenant -> 403 +
 * DENIED. Idempotency-Key makes a retried create yield ONE family.
 */
import { apiErr, apiOk } from "../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../runtime/auth/runtime-context.js";
import type { OpportunityFamily } from "../../../contracts/geo-business/entities.js";
import type { OpportunityFamilyViewV1 } from "../../../runtime/commands/geo-dto.js";
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

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  try {
    const geo = createGeoCommandRuntime(rt.db);
    const families = await geo.repos.opportunityFamilies.listByOrganization(session.organizationId);
    const views: OpportunityFamilyViewV1[] = families.map((f) => ({
      id: f.id, clientOrganizationId: f.clientOrganizationId, projectId: f.projectId,
      memberOpportunityIds: f.members.map((m) => m.opportunityId), createdAt: f.createdAt,
    }));
    return toHttpResponse(apiOk(views));
  } catch (err) {
    console.error("GET /api/opportunity-families failed:", err);
    return toHttpResponse(apiErr("INTERNAL_ERROR", "Failed to load opportunity families."));
  }
}

const ACTION = "opportunity_family.command.create";

type FamilyMembers = OpportunityFamily["members"];

/** Parse `members` into the non-empty family-member tuple; each needs an opportunity + decision id. */
function parseMembers(raw: unknown): FamilyMembers | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: OpportunityFamily["members"][number][] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const rec = item as Record<string, unknown>;
    const opportunityId =
      typeof rec["opportunityId"] === "string" ? rec["opportunityId"].trim() : "";
    const decisionId =
      typeof rec["authorizingHumanReviewDecisionId"] === "string"
        ? rec["authorizingHumanReviewDecisionId"].trim()
        : "";
    if (opportunityId === "" || decisionId === "") return null;
    out.push({
      opportunityId,
      authorizingHumanReviewDecisionId: decisionId,
      authorizingReviewDecisionStatus: "APPROVED",
    });
  }
  return out as FamilyMembers;
}

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const body = await readJsonBody(request);
  const projectId = readString(body, "projectId");
  const members = parseMembers(body["members"]);
  if (!projectId || !members) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "projectId and a non-empty members[] (each with opportunityId + authorizingHumanReviewDecisionId) are required.",
      ),
    );
  }

  const project = await rt.repos.projects.findById(projectId);
  if (!project) return toHttpResponse(apiErr("NOT_FOUND", "Project not found."));
  const tenant = { clientOrganizationId: project.clientOrganizationId, projectId: project.id };

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "OpportunityFamily");
  if (denied) return denied;

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<OpportunityFamilyViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);
        const family = await invokeDomain(() =>
          geo.services.family.createFamily(authContext, {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            members,
          }),
        );
        const view: OpportunityFamilyViewV1 = {
          id: family.id,
          clientOrganizationId: family.clientOrganizationId,
          projectId: family.projectId,
          memberOpportunityIds: family.members.map((m) => m.opportunityId),
          createdAt: family.createdAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "OpportunityFamily",
            targetId: family.id,
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
