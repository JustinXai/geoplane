/**
 * POST /api/article-drafts/compile — compiles an ArticleDraft from an ArticleBrief and its ingested
 * provider content (GEO chain item 9, "Article compiler").
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2).
 *
 * Supports two modes:
 *
 * 1. ONLINE MODE (PROVIDER_RUNTIME_ENABLED=true):
 *    - Request supplies an opaque `providerResponseEnvelopeId`
 *    - This is a pointer to a raw provider envelope produced entirely out-of-band
 *    - Route ingests that pointer and delegates compilation to the frozen pure `compileArticleDraft`
 *
 * 2. OFFLINE MODE (PROVIDER_RUNTIME_ENABLED=false, default):
 *    - Request does NOT need `providerResponseEnvelopeId`
 *    - Route uses OfflineDraftGenerator to create a valid draft without any provider call
 *    - Draft sections are derived from the brief's outline
 *    - Provider Calls = 0, structurally
 *
 * Compilation is append-only: each call produces a NEW draft with an incremented version;
 * no existing draft is mutated.
 *
 * Server-side tenant resolution: the tenant is read from the referenced ArticleBrief, never the
 * body. Cross-tenant -> 403 + DENIED. Idempotency-Key makes a retried compile yield ONE draft.
 */
import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import type { ArticleDraftCommandViewV1 } from "../../../../runtime/commands/geo-dto.js";
import {
  buildGeoAuthorizationContext,
  createGeoCommandRuntime,
  invokeDomain,
} from "../../../../runtime/commands/geo-command-runtime.js";
import {
  denyIfCrossTenant,
  isResponse,
  requireSession,
} from "../../../../runtime/commands/geo-command-http.js";
import { readString } from "../../../../runtime/commands/geo-command-input.js";
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../runtime/commands/runtime-context.js";
import { isProviderRuntimeEnabled } from "../../../../runtime/provider/feature-flag.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "article_draft.command.compile";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();

  const session = await requireSession(rt, request);
  if (isResponse(session)) return session;
  const actor = { userId: session.userId, organizationId: session.organizationId };

  const body = await readJsonBody(request);
  const articleBriefId = readString(body, "articleBriefId");
  const providerResponseEnvelopeId = readString(body, "providerResponseEnvelopeId") ?? null;

  if (!articleBriefId) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "articleBriefId is required."),
    );
  }

  // Server-side tenant resolution: read the referenced brief's tenant, never trust the body.
  const briefForTenant = await createGeoCommandRuntime(rt.db).repos.articleBriefs.getById(
    articleBriefId,
  );
  if (!briefForTenant) {
    return toHttpResponse(apiErr("NOT_FOUND", "Article brief not found."));
  }
  const tenant = {
    clientOrganizationId: briefForTenant.clientOrganizationId,
    projectId: briefForTenant.projectId,
  };
  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "ArticleDraft");
  if (denied) return denied;

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<ArticleDraftCommandViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const brief = await geo.repos.articleBriefs.getById(articleBriefId);
        if (!brief) throw new CommandAbortError("NOT_FOUND", "Article brief not found.");

        const providerRuntimeEnabled = isProviderRuntimeEnabled();

        if (providerRuntimeEnabled && providerResponseEnvelopeId) {
          // ONLINE MODE: Ingest the opaque offline envelope pointer (NOT a provider call), then compile.
          await invokeDomain(() =>
            geo.services.pipeline.ingestProviderArticleContent(
              authContext,
              brief,
              providerResponseEnvelopeId,
            ),
          );
          const providerContents = await geo.repos.providerArticleContents.listByArticleBrief(
            brief.id,
          );
          const draft = await invokeDomain(() =>
            geo.services.pipeline.compileDraft(authContext, brief, providerContents),
          );

          const view: ArticleDraftCommandViewV1 = {
            id: draft.id,
            clientOrganizationId: draft.clientOrganizationId,
            projectId: draft.projectId,
            articleBriefId: draft.articleBriefId,
            version: draft.version,
            title: draft.title,
            status: "DRAFT",
            sectionCount: draft.sections.length,
            sourceProviderArticleContentIds: draft.sourceProviderArticleContentIds,
            compiledAt: draft.compiledAt,
          };
          return {
            dto: view,
            audit: {
              clientOrganizationId: draft.clientOrganizationId,
              projectId: draft.projectId,
              targetType: "ArticleDraft",
              targetId: draft.id,
              metadata: { articleBriefId: draft.articleBriefId, version: draft.version, mode: "online" },
            },
          };
        } else {
          // OFFLINE MODE: Generate draft without any provider call.
          // This uses OfflineDraftGenerator which creates a valid ArticleDraft
          // with sections derived from the brief's outline.
          const { providerContent, draft } = await invokeDomain(() =>
            geo.services.offline.generateDraft(authContext, { brief }),
          );

          const view: ArticleDraftCommandViewV1 = {
            id: draft.id,
            clientOrganizationId: draft.clientOrganizationId,
            projectId: draft.projectId,
            articleBriefId: draft.articleBriefId,
            version: draft.version,
            title: draft.title,
            status: "DRAFT",
            sectionCount: draft.sections.length,
            sourceProviderArticleContentIds: draft.sourceProviderArticleContentIds,
            compiledAt: draft.compiledAt,
          };
          return {
            dto: view,
            audit: {
              clientOrganizationId: draft.clientOrganizationId,
              projectId: draft.projectId,
              targetType: "ArticleDraft",
              targetId: draft.id,
              metadata: {
                articleBriefId: draft.articleBriefId,
                version: draft.version,
                mode: "offline",
                providerContentId: providerContent.id,
              },
            },
          };
        }
      },
    });
    return toHttpResponse(apiOk(dto));
  } catch (err) {
    if (err instanceof CommandAbortError) return toHttpResponse(err.response);
    throw err;
  }
}
