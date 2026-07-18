/**
 * POST /api/commands/projects/[projectId]/enterprise-profile — creates the project's geo
 * IndustryProfile: the vertical/industry classification context its knowledge, keywords, and
 * article gates are validated against (GEO business chain items 2 + downstream gates).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2). Mounted under /api/commands/** per the lane's
 * namespace convention (the project's public read surface lives at /api/projects/[projectId]/**).
 *
 * Server-side tenant resolution (SYSTEM_INVARIANTS_V1.md): the tenant is the project's owning
 * client organization, resolved from the session's grants — never a body value. A caller not
 * authorized for that client org is 403 + a DENIED audit event. Idempotency-Key (header/body)
 * makes a retried create yield ONE profile.
 */
import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../../runtime/auth/runtime-context.js";
import type { GeoValidationGateLevel } from "../../../../../../contracts/geo-business/entities.js";
import type { IndustryProfileViewV1 } from "../../../../../../runtime/commands/geo-dto.js";
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
import { readInteger, readString } from "../../../../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "industry_profile.command.create";

function asGateLevel(value: string): GeoValidationGateLevel | null {
  return value === "PLATFORM_WIDE_GATE" || value === "INDUSTRY_VERTICAL_GATE" ? value : null;
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

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "IndustryProfile");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const verticalSlug = readString(body, "verticalSlug");
  const verticalLabel = readString(body, "verticalLabel");
  const gateLevelRaw = readString(body, "validationGateLevel");
  const ruleSetVersion = readInteger(body, "ruleSetVersion");
  if (!verticalSlug || !verticalLabel || !gateLevelRaw || ruleSetVersion === null) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "verticalSlug, verticalLabel, validationGateLevel and ruleSetVersion are required.",
      ),
    );
  }
  const validationGateLevel = asGateLevel(gateLevelRaw);
  if (!validationGateLevel) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "validationGateLevel must be PLATFORM_WIDE_GATE or INDUSTRY_VERTICAL_GATE.",
      ),
    );
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<IndustryProfileViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);
        const profile = await invokeDomain(() =>
          geo.services.keywordQuestion.createIndustryProfile(authContext, {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            verticalSlug,
            verticalLabel,
            validationGateLevel,
            ruleSetVersion,
          }),
        );
        const view: IndustryProfileViewV1 = {
          id: profile.id,
          clientOrganizationId: profile.clientOrganizationId,
          projectId: profile.projectId,
          verticalSlug: profile.verticalSlug,
          verticalLabel: profile.verticalLabel,
          validationGateLevel: profile.validationGateLevel,
          ruleSetVersion: profile.ruleSetVersion,
          createdAt: profile.createdAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "IndustryProfile",
            targetId: profile.id,
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
