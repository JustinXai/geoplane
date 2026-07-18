/**
 * POST /api/commands/projects/[projectId]/opportunities — derives an Opportunity from one
 * KeywordQuestionMap entry (GEO chain item 4) AND records its automated OpportunityValidation
 * outcome (chain item 5), atomically. A VALIDATED validation is NOT an approval — approval is a
 * separate, explicit human-review step (see /api/opportunities/[id]/reviews).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2). Mounted under /api/commands/** (a GET route already
 * exists at /api/projects/[projectId]/opportunities).
 *
 * Server-side tenant resolution: tenant = the project's owning client org. The grounding
 * KnowledgePackage and validating IndustryProfile are BOTH derived from the referenced
 * KeywordQuestionMap (which already pins them), never from a body org id. Cross-tenant -> 403 +
 * DENIED. Idempotency-Key makes a retried create yield ONE opportunity + validation.
 */
import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../../runtime/auth/runtime-context.js";
import type { OpportunityCommandViewV1 } from "../../../../../../runtime/commands/geo-dto.js";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "opportunity.command.create";

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

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "Opportunity");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const keywordQuestionMapId = readString(body, "keywordQuestionMapId");
  const keyword = readString(body, "keyword");
  const reasonNote =
    readString(body, "reasonNote") ?? "Automated validation: knowledge-grounded, on-vertical.";
  if (!keywordQuestionMapId || !keyword) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "keywordQuestionMapId and keyword are required."),
    );
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<OpportunityCommandViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const map = await geo.repos.keywordQuestionMaps.getById(keywordQuestionMapId);
        if (
          !map ||
          map.clientOrganizationId !== tenant.clientOrganizationId ||
          map.projectId !== tenant.projectId
        ) {
          throw new CommandAbortError(
            "NOT_FOUND",
            "Keyword-question map not found for this project.",
          );
        }

        const knowledgePackage = await geo.repos.knowledgePackages.getById(map.knowledgePackageId);
        if (!knowledgePackage) {
          throw new CommandAbortError(
            "NOT_FOUND",
            "Grounding knowledge package for this map no longer exists.",
          );
        }

        const industryProfile = await geo.repos.industryProfiles.getById(map.industryProfileId);
        if (!industryProfile) {
          throw new CommandAbortError(
            "NOT_FOUND",
            "Validating industry profile for this map no longer exists.",
          );
        }

        const opportunity = await invokeDomain(() =>
          geo.services.opportunity.createOpportunity(authContext, {
            keywordQuestionMap: map,
            keyword,
            knowledgePackage,
          }),
        );
        const validation = await invokeDomain(() =>
          geo.services.validation.validateOpportunity(authContext, {
            opportunity,
            industryProfile,
            status: "VALIDATED",
            reasonNote,
          }),
        );

        const view: OpportunityCommandViewV1 = {
          opportunity: {
            id: opportunity.id,
            clientOrganizationId: opportunity.clientOrganizationId,
            projectId: opportunity.projectId,
            keywordQuestionMapId: opportunity.keywordQuestionMapId,
            keyword: opportunity.keyword,
            groundingKnowledgePackageId: opportunity.groundingKnowledgePackageId,
            groundingKnowledgePackageVersion: opportunity.groundingKnowledgePackageVersion,
            createdAt: opportunity.createdAt,
          },
          validation: {
            id: validation.id,
            opportunityId: validation.opportunityId,
            status: validation.status,
            industryProfileId: validation.industryProfileId,
            gateLevelApplied: validation.gateLevelApplied,
            validatedAt: validation.validatedAt,
          },
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "Opportunity",
            targetId: opportunity.id,
            metadata: { opportunityValidationId: validation.id },
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
