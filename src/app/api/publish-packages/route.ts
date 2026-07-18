/**
 * POST /api/publish-packages — builds the publication-ready PublishPackage from an ArticleApproval
 * and its channel-neutral content package (GEO chain items 11-12).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * Platform-neutral by default (SYSTEM_INVARIANTS_V1.md "Publication"): the channel-neutral content
 * package is created via the frozen smart constructor, which ALWAYS initializes targetChannelIds to
 * [] — DEFAULT SELECTED CHANNEL COUNT = 0. There is no parameter here that pre-seeds a channel;
 * choosing channels is a separate, explicit DistributionPlan step. A package is only built from a
 * real ArticleApproval (nothing is packaged without an approval).
 *
 * Server-side tenant resolution: the tenant is read from the referenced ArticleApproval, never the
 * body. Cross-tenant -> 403 + DENIED. Idempotency-Key makes a retried create yield ONE package.
 */
import { apiErr, apiOk } from "../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../runtime/auth/runtime-context.js";
import type { ChannelNeutralContentBlock } from "../../../contracts/geo-business/entities.js";
import type { PublishPackageCommandViewV1 } from "../../../runtime/commands/geo-dto.js";
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

const ACTION = "publish_package.command.create";

const BLOCK_KINDS = new Set(["HEADING", "PARAGRAPH", "LIST", "IMAGE_REFERENCE"]);

/** Parse an optional channel-neutral `blocks[]`; returns [] when omitted, null when malformed. */
function parseBlocks(raw: unknown): ChannelNeutralContentBlock[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: ChannelNeutralContentBlock[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const rec = item as Record<string, unknown>;
    const kind = rec["kind"];
    const text = rec["text"];
    const order = rec["order"];
    if (typeof kind !== "string" || !BLOCK_KINDS.has(kind)) return null;
    if (typeof text !== "string") return null;
    if (typeof order !== "number" || !Number.isInteger(order)) return null;
    out.push({ kind: kind as ChannelNeutralContentBlock["kind"], text, order });
  }
  return out;
}

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const body = await readJsonBody(request);
  const articleApprovalId = readString(body, "articleApprovalId");
  const blocks = parseBlocks(body["blocks"]);
  if (!articleApprovalId || blocks === null) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "articleApprovalId is required and blocks[], if present, must each have kind/text/order.",
      ),
    );
  }

  // Server-side tenant resolution: read the referenced approval's tenant, never trust the body.
  const approvalForTenant = await createGeoCommandRuntime(rt.db).repos.articleApprovals.getById(
    articleApprovalId,
  );
  if (!approvalForTenant) {
    return toHttpResponse(apiErr("NOT_FOUND", "Article approval not found."));
  }
  const tenant = {
    clientOrganizationId: approvalForTenant.clientOrganizationId,
    projectId: approvalForTenant.projectId,
  };
  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "PublishPackage");
  if (denied) return denied;

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<PublishPackageCommandViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const approval = await geo.repos.articleApprovals.getById(articleApprovalId);
        if (!approval) throw new CommandAbortError("NOT_FOUND", "Article approval not found.");

        const draft = await geo.repos.articleDrafts.getById(approval.articleDraftId);
        if (!draft) {
          throw new CommandAbortError("NOT_FOUND", "Approved article draft no longer exists.");
        }

        const publishPackage = await invokeDomain(() =>
          geo.services.publish.createPublishPackage(authContext, approval, draft),
        );
        const cnc = await invokeDomain(() =>
          geo.services.publish.createChannelNeutralPackage(authContext, publishPackage, blocks),
        );

        const view: PublishPackageCommandViewV1 = {
          publishPackage: {
            id: publishPackage.id,
            clientOrganizationId: publishPackage.clientOrganizationId,
            projectId: publishPackage.projectId,
            articleApprovalId: publishPackage.articleApprovalId,
            articleDraftId: publishPackage.articleDraftId,
            title: publishPackage.title,
            builtAt: publishPackage.builtAt,
          },
          channelNeutralContentPackage: {
            id: cnc.id,
            publishPackageId: cnc.publishPackageId,
            // Zero by construction — no channel is ever auto-selected.
            selectedChannelCount: cnc.targetChannelIds.length,
            blockCount: cnc.blocks.length,
            createdAt: cnc.createdAt,
          },
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: publishPackage.clientOrganizationId,
            projectId: publishPackage.projectId,
            targetType: "PublishPackage",
            targetId: publishPackage.id,
            metadata: {
              channelNeutralContentPackageId: cnc.id,
              selectedChannelCount: cnc.targetChannelIds.length,
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
