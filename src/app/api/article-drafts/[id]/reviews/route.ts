/**
 * POST /api/article-drafts/[id]/reviews — the article-approval gate (GEO chain item 10): evaluates
 * the three publication gates (quality, platform, vertical) for a draft and, only if all three
 * PASS, records the final ArticleApproval.
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * NEVER auto-approved: approval requires a real approver AND three PASSED gate results (the frozen
 * QualityGateService types approveArticle's gate parameters to the PASSED variant only). If any
 * gate fails, the request is 422 with the gate failure reasons and NO approval is written.
 *
 * Approver identity comes from the authenticated session (a real `user` row — the human approving),
 * never from request input: article_approval.approver_user_id is a real "user" FK, and identity is
 * always server-derived (SYSTEM_INVARIANTS_V1.md).
 *
 * `[id]` is the ArticleDraft id. Server-side tenant resolution: the tenant is read from the
 * persisted draft, never the body; the IndustryProfile named for the platform/vertical gates is
 * verified to belong to that tenant. Cross-tenant -> 403 + DENIED. Idempotency-Key replays.
 */
import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../runtime/auth/runtime-context.js";
import type { ArticleApprovalViewV1 } from "../../../../../runtime/commands/geo-dto.js";
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

const ACTION = "article.approval.command.create";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { id } = await context.params;

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  // Server-side tenant resolution: read the persisted draft's tenant, never trust the body.
  const draftForTenant = await createGeoCommandRuntime(rt.db).repos.articleDrafts.getById(id);
  if (!draftForTenant) return toHttpResponse(apiErr("NOT_FOUND", "Article draft not found."));
  const tenant = {
    clientOrganizationId: draftForTenant.clientOrganizationId,
    projectId: draftForTenant.projectId,
  };

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "ArticleApproval");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const industryProfileId = readString(body, "industryProfileId");
  // The approver is the authenticated human — a real user, resolved server-side, never trusted.
  const approverId = actor.userId;
  if (!industryProfileId) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "industryProfileId is required."),
    );
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<ArticleApprovalViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const draft = await geo.repos.articleDrafts.getById(id);
        if (!draft) throw new CommandAbortError("NOT_FOUND", "Article draft not found.");

        const brief = await geo.repos.articleBriefs.getById(draft.articleBriefId);
        if (!brief) {
          throw new CommandAbortError("NOT_FOUND", "Article brief for this draft no longer exists.");
        }

        const industryProfile = await geo.repos.industryProfiles.getById(industryProfileId);
        if (
          !industryProfile ||
          industryProfile.clientOrganizationId !== tenant.clientOrganizationId ||
          industryProfile.projectId !== tenant.projectId
        ) {
          throw new CommandAbortError(
            "NOT_FOUND",
            "Industry profile not found for this project.",
          );
        }

        const qualityGate = await invokeDomain(() =>
          geo.services.gates.evaluateQuality(authContext, draft, brief),
        );
        const platformGate = await invokeDomain(() =>
          geo.services.gates.evaluatePlatformGate(authContext, draft, industryProfile),
        );
        const verticalGate = await invokeDomain(() =>
          geo.services.gates.evaluateVerticalGate(authContext, draft, industryProfile),
        );

        // NO auto-approve: a failed gate blocks approval and returns its reasons; nothing is written.
        const failureReasons: string[] = [];
        if (qualityGate.status === "FAILED") failureReasons.push(...qualityGate.failureReasons);
        if (platformGate.status === "FAILED") failureReasons.push(...platformGate.failureReasons);
        if (verticalGate.status === "FAILED") failureReasons.push(...verticalGate.failureReasons);
        if (
          qualityGate.status !== "PASSED" ||
          platformGate.status !== "PASSED" ||
          verticalGate.status !== "PASSED"
        ) {
          throw new CommandAbortError(
            "VALIDATION_FAILED",
            "Article draft did not pass all publication gates; approval refused.",
            { failureReasons },
          );
        }

        const approval = await invokeDomain(() =>
          geo.services.gates.approveArticle(
            authContext,
            draft,
            approverId,
            qualityGate,
            platformGate,
            verticalGate,
          ),
        );

        const view: ArticleApprovalViewV1 = {
          id: approval.id,
          clientOrganizationId: approval.clientOrganizationId,
          projectId: approval.projectId,
          articleDraftId: approval.articleDraftId,
          approverId: approval.approverId,
          approvedAt: approval.approvedAt,
          qualityGateId: approval.qualityGateId,
          platformGateId: approval.platformGateId,
          verticalGateId: approval.verticalGateId,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: approval.clientOrganizationId,
            projectId: approval.projectId,
            targetType: "ArticleApproval",
            targetId: approval.id,
            metadata: { articleDraftId: approval.articleDraftId },
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
