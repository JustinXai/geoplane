/**
 * POST /api/commands/projects/[projectId]/keyword-maps — creates a KeywordQuestionMap: the
 * keyword <-> real-user-question mapping sourced from a KnowledgePackage and validated against the
 * project's IndustryProfile (GEO business chain item 3).
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 2). Mounted under /api/commands/**.
 *
 * Server-side tenant resolution: the tenant is the project's owning client org (from the session's
 * grants). Both referenced artifacts — the KnowledgePackage and the IndustryProfile — are verified
 * to belong to that same tenant (never trusting the body's client org). Cross-tenant -> 403 +
 * DENIED. Idempotency-Key makes a retried create yield ONE map.
 */
import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../../runtime/auth/runtime-context.js";
import type { KeywordQuestionEntry } from "../../../../../../contracts/geo-business/entities.js";
import type { KeywordQuestionMapViewV1 } from "../../../../../../runtime/commands/geo-dto.js";
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

const ACTION = "keyword_question_map.command.create";

/** Parse the request `entries` into KeywordQuestionEntry[]: each needs a keyword + >=1 question. */
function parseEntries(raw: unknown): KeywordQuestionEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: KeywordQuestionEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const rec = item as Record<string, unknown>;
    const keyword = typeof rec["keyword"] === "string" ? rec["keyword"].trim() : "";
    if (keyword === "") return null;
    const questionsRaw = rec["questions"];
    if (!Array.isArray(questionsRaw) || questionsRaw.length === 0) return null;
    const questions: string[] = [];
    for (const q of questionsRaw) {
      if (typeof q !== "string" || q.trim() === "") return null;
      questions.push(q.trim());
    }
    out.push({ keyword, questions });
  }
  return out;
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

  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "KeywordQuestionMap");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const knowledgePackageId = readString(body, "knowledgePackageId");
  const industryProfileId = readString(body, "industryProfileId");
  const entries = parseEntries(body["entries"]);
  if (!knowledgePackageId || !industryProfileId || !entries) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "knowledgePackageId, industryProfileId and a non-empty entries[] (each with a keyword and >=1 question) are required.",
      ),
    );
  }

  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand<KeywordQuestionMapViewV1>({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);

        const knowledgePackage = await geo.repos.knowledgePackages.getById(knowledgePackageId);
        if (
          !knowledgePackage ||
          knowledgePackage.clientOrganizationId !== tenant.clientOrganizationId ||
          knowledgePackage.projectId !== tenant.projectId
        ) {
          throw new CommandAbortError(
            "NOT_FOUND",
            "Knowledge package not found for this project.",
          );
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

        const map = await invokeDomain(() =>
          geo.services.keywordQuestion.createKeywordQuestionMap(authContext, {
            knowledgePackage,
            industryProfileId: industryProfile.id,
            entries,
          }),
        );
        const view: KeywordQuestionMapViewV1 = {
          id: map.id,
          clientOrganizationId: map.clientOrganizationId,
          projectId: map.projectId,
          knowledgePackageId: map.knowledgePackageId,
          knowledgePackageVersion: map.knowledgePackageVersion,
          industryProfileId: map.industryProfileId,
          keywords: map.entries.map((e) => e.keyword),
          createdAt: map.createdAt,
        };
        return {
          dto: view,
          audit: {
            clientOrganizationId: tenant.clientOrganizationId,
            projectId: tenant.projectId,
            targetType: "KeywordQuestionMap",
            targetId: map.id,
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
