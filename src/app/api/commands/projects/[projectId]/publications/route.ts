/**
 * POST /api/commands/projects/[projectId]/publications — creates a Publication Package
 * from an Approved Draft (ArticleApproval + ArticleDraft).
 *
 * This route implements the "Publication Package" step in the content delivery chain:
 *   - ArticleApproval (approved by human) + ArticleDraft -> PublishPackage
 *   - PublishPackage -> ChannelNeutralContentPackage (0 selected channels by default)
 *
 * The operator provides content blocks for the channel-neutral package. The package
 * starts with zero selected channels — channel selection happens via DistributionPlan.
 *
 * Server-side tenant resolution: the client org is the project's owning client org,
 * from the session's grants — never a body value. Cross-tenant -> 403 + DENIED audit.
 * Idempotency-Key makes a retried create yield ONE publication package.
 */
import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../../runtime/auth/runtime-context.js";
import type { PublishPackageCommandViewV1 } from "../../../../../../runtime/commands/geo-dto.js";
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
import { readString, readOptionalStringArray } from "../../../../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../../../runtime/commands/runtime-context.js";
import type { ChannelNeutralContentBlock } from "../../../../../../contracts/geo-business/entities.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "publication_package.command.create";

interface ContentBlockInput {
  kind: "HEADING" | "PARAGRAPH" | "LIST" | "IMAGE_REFERENCE";
  text: string;
  order: number;
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

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "publication_package");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const articleApprovalId = readString(body, "articleApprovalId");
  const articleDraftId = readString(body, "articleDraftId");
  const blocksInput = body["contentBlocks"];

  if (!articleApprovalId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "articleApprovalId is required."));
  }
  if (!articleDraftId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "articleDraftId is required."));
  }
  if (!Array.isArray(blocksInput)) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "contentBlocks is required and must be an array."));
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<PublishPackageCommandViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);

        // Fetch the approval
        const approval = await geo.repos.articleApprovals.getById(articleApprovalId);
        if (!approval) {
          throw new CommandAbortError("NOT_FOUND", "ArticleApproval not found.");
        }
        if (approval.clientOrganizationId !== tenant.clientOrganizationId) {
          throw new CommandAbortError("FORBIDDEN", "ArticleApproval does not belong to this tenant.");
        }

        // Fetch the draft
        const draft = await geo.repos.articleDrafts.getById(articleDraftId);
        if (!draft) {
          throw new CommandAbortError("NOT_FOUND", "ArticleDraft not found.");
        }
        if (draft.clientOrganizationId !== tenant.clientOrganizationId) {
          throw new CommandAbortError("FORBIDDEN", "ArticleDraft does not belong to this tenant.");
        }

        const authContext = buildGeoAuthorizationContext(session);

        // Build PublishPackage
        const pkg = await geo.services.publish.createPublishPackage(authContext, approval, draft);

        // Build ChannelNeutralContentPackage with provided blocks
        const contentBlocks: ChannelNeutralContentBlock[] = (blocksInput as ContentBlockInput[]).map((b, i) => ({
          kind: b.kind,
          text: b.text,
          order: b.order ?? i,
        }));

        const cnc = await geo.services.publish.createChannelNeutralPackage(authContext, pkg, contentBlocks);

        const view: PublishPackageCommandViewV1 = {
          publishPackage: {
            id: pkg.id,
            clientOrganizationId: pkg.clientOrganizationId,
            projectId: pkg.projectId,
            articleApprovalId: pkg.articleApprovalId,
            articleDraftId: pkg.articleDraftId,
            title: pkg.title,
            builtAt: pkg.builtAt,
          },
          channelNeutralContentPackage: {
            id: cnc.id,
            publishPackageId: cnc.publishPackageId,
            selectedChannelCount: cnc.targetChannelIds.length,
            blockCount: cnc.blocks.length,
            createdAt: cnc.createdAt,
          },
        };

        return {
          dto: view,
          audit: {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "publish_package",
            targetId: pkg.id,
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
