/**
 * POST /api/commands/projects/[projectId]/drafts/[draftId]/gate — Light Gate evaluation
 * for ArticleDrafts.
 *
 * This is the first-pass gate evaluation that runs BEFORE the full quality/platform/vertical
 * gate chain. It focuses on content quality issues that are repairable or represent hard risks.
 *
 * BUSINESS_COMMAND_API_V1 (Agent L — Light Gate + Human Review).
 *
 * NEVER auto-passes: the gate always returns the actual verdict with issues.
 * When verdict is REPAIR, the repaired draft is persisted and returned.
 * Human review is required for REPAIR and REJECT verdicts.
 *
 * Gate principles:
 *   - Viral/传播 effect first
 *   - Facts and hard risk as fallback
 *   - Repairable issues → REPAIR
 *   - Real hard risks → REJECT
 *
 * [projectId] is the project id. [draftId] is the ArticleDraft id.
 * Server-side tenant resolution from the draft's persisted client_organization_id.
 * Cross-tenant -> 403 + DENIED.
 */
import { apiErr, apiOk } from "@/runtime/api-contracts/index.js";
import { toHttpResponse } from "@/runtime/auth/http.js";
import { getAuthRuntime } from "@/runtime/auth/runtime-context.js";
import type { LightGateResult } from "@/runtime/geo/services/light-draft-gate-service.js";
import {
  buildGeoAuthorizationContext,
  createGeoCommandRuntime,
  invokeDomain,
} from "@/runtime/commands/geo-command-runtime.js";
import {
  denyIfCrossTenant,
  isResponse,
  requireSession,
} from "@/runtime/commands/geo-command-http.js";
import {
  CommandAbortError,
  runWriteCommand,
} from "@/runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "article.draft.gate.evaluate";

/** View model for light gate results. */
export interface LightGateResultViewV1 {
  readonly verdict: "PASS" | "REPAIR" | "REJECT";
  readonly issues: ReadonlyArray<{
    readonly category: string;
    readonly severity: string;
    readonly message: string;
    readonly repairHint?: string;
    readonly sectionIndex?: number;
  }>;
  readonly repairedDraftId?: string;
  readonly evaluatedAt: string;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; draftId: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { projectId, draftId } = await context.params;

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  // Server-side tenant resolution: read the persisted draft's tenant, never trust the body.
  const draftForTenant = await createGeoCommandRuntime(rt.db).repos.articleDrafts.getById(draftId);
  if (!draftForTenant) {
    return toHttpResponse(apiErr("NOT_FOUND", "Article draft not found."));
  }

  // Verify projectId matches the draft's project
  if (draftForTenant.projectId !== projectId) {
    return toHttpResponse(
      apiErr("NOT_FOUND", "Article draft not found in this project."),
    );
  }

  const tenant = {
    clientOrganizationId: draftForTenant.clientOrganizationId,
    projectId: draftForTenant.projectId,
  };

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "ArticleDraft");
  if (denied) return denied;

  try {
    const { dto } = await runWriteCommand<LightGateResultViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey: undefined,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const draft = await geo.repos.articleDrafts.getById(draftId);
        if (!draft) {
          throw new CommandAbortError("NOT_FOUND", "Article draft not found.");
        }

        // Verify the draft belongs to the specified project
        if (draft.projectId !== projectId) {
          throw new CommandAbortError("NOT_FOUND", "Article draft not found in this project.");
        }

        // Create and evaluate the light gate with repository for repair persistence
        const { LightDraftGateService } = await import("@/runtime/geo/services/light-draft-gate-service.js");
        const lightGateService = new LightDraftGateService(geo.infra, geo.repos.articleDrafts);
        const result = await invokeDomain(() =>
          lightGateService.evaluateAndRepair(authContext, draft),
        );

        // Build the view model
        const view: LightGateResultViewV1 = {
          verdict: result.verdict,
          issues: result.issues.map((issue) => ({
            category: issue.category,
            severity: issue.severity,
            message: issue.message,
            ...(issue.repairHint ? { repairHint: issue.repairHint } : {}),
            ...(issue.sectionIndex !== undefined ? { sectionIndex: issue.sectionIndex } : {}),
          })),
          ...(result.repairedDraft ? { repairedDraftId: result.repairedDraft.id } : {}),
          evaluatedAt: result.evaluatedAt,
        };

        return {
          dto: view,
          audit: {
            clientOrganizationId: draft.clientOrganizationId,
            projectId: draft.projectId,
            targetType: "ArticleDraft",
            targetId: draftId,
            metadata: {
              verdict: result.verdict,
              issueCount: result.issues.length,
              ...(result.repairedDraft ? { repairedDraftId: result.repairedDraft.id } : {}),
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
