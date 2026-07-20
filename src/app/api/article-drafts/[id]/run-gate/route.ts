/**
 * POST /api/article-drafts/[id]/run-gate — runs the three publication gates (quality, platform,
 * vertical) on an ArticleDraft and returns the results without recording an ArticleApproval.
 * Persists the gate results to the database.
 *
 * Per SYSTEM_INVARIANTS_V1: server-side tenant resolution from the persisted draft.
 */
import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../runtime/auth/runtime-context.js";
import type { ArticleGateResultViewV1 } from "../../../../../runtime/commands/geo-dto.js";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { id } = await context.params;

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  // Read draft's tenant from persisted record.
  const cmdRt = createGeoCommandRuntime(rt.db);
  const draftForTenant = await cmdRt.repos.articleDrafts.getById(id);
  if (!draftForTenant) return toHttpResponse(apiErr("NOT_FOUND", "Article draft not found."));

  const tenant = {
    clientOrganizationId: draftForTenant.clientOrganizationId,
    projectId: draftForTenant.projectId,
  };
  const denied = await denyIfCrossTenant(rt, session, actor, tenant, "article_draft.command.runGate", "ArticleDraft");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const industryProfileId = readString(body, "industryProfileId");
  if (!industryProfileId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "industryProfileId is required."));
  }

  const authContext = buildGeoAuthorizationContext(session);

  // Load domain objects.
  const draft = await cmdRt.repos.articleDrafts.getById(id);
  if (!draft) return toHttpResponse(apiErr("NOT_FOUND", "Article draft not found."));

  const brief = await cmdRt.repos.articleBriefs.getById(draft.articleBriefId);
  if (!brief) return toHttpResponse(apiErr("NOT_FOUND", "Article brief not found."));

  const industryProfile = await cmdRt.repos.industryProfiles.getById(industryProfileId);
  if (
    !industryProfile ||
    industryProfile.clientOrganizationId !== tenant.clientOrganizationId ||
    industryProfile.projectId !== tenant.projectId
  ) {
    return toHttpResponse(apiErr("NOT_FOUND", "Industry profile not found for this project."));
  }

  // Evaluate gates.
  const [qualityGate, platformGate, verticalGate] = await Promise.all([
    invokeDomain(() => cmdRt.services.gates.evaluateQuality(authContext, draft, brief)),
    invokeDomain(() => cmdRt.services.gates.evaluatePlatformGate(authContext, draft, industryProfile)),
    invokeDomain(() => cmdRt.services.gates.evaluateVerticalGate(authContext, draft, industryProfile)),
  ]);

  // Persist results.
  await Promise.all([
    cmdRt.repos.qualityGates.add(qualityGate),
    cmdRt.repos.platformGates.add(platformGate),
    cmdRt.repos.verticalGates.add(verticalGate),
  ]);

  const failureReasons: string[] = [];
  if (qualityGate.status === "FAILED") failureReasons.push(...qualityGate.failureReasons);
  if (platformGate.status === "FAILED") failureReasons.push(...platformGate.failureReasons);
  if (verticalGate.status === "FAILED") failureReasons.push(...verticalGate.failureReasons);

  const result: ArticleGateResultViewV1 = {
    articleDraftId: id,
    qualityGate: {
      id: qualityGate.id,
      status: qualityGate.status,
      failureReasons: qualityGate.status === "FAILED" ? qualityGate.failureReasons : [],
      evaluatedAt: qualityGate.evaluatedAt,
    },
    platformGate: {
      id: platformGate.id,
      status: platformGate.status,
      failureReasons: platformGate.status === "FAILED" ? platformGate.failureReasons : [],
      evaluatedAt: platformGate.evaluatedAt,
    },
    verticalGate: {
      id: verticalGate.id,
      status: verticalGate.status,
      failureReasons: verticalGate.status === "FAILED" ? verticalGate.failureReasons : [],
      evaluatedAt: verticalGate.evaluatedAt,
    },
    overallPassed:
      qualityGate.status === "PASSED" &&
      platformGate.status === "PASSED" &&
      verticalGate.status === "PASSED",
    failureReasons,
  };

  return toHttpResponse(apiOk(result));
}
