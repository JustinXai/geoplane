import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../../runtime/auth/runtime-context.js";
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
import {
  CommandAbortError,
  readIdempotencyKey,
  runWriteCommand,
} from "../../../../../../runtime/commands/runtime-context.js";
import { ExistingOpportunityConnector } from "../../../../../../runtime/knowledge-opportunity/existing-opportunity-connector.js";
import { DeterministicKnowledgeOpportunityGenerator } from "../../../../../../runtime/knowledge-opportunity/offline-generator.js";
import { PgKnowledgeGroundingPort } from "../../../../../../runtime/knowledge-opportunity/pg-grounding-port.js";
import { KnowledgeFirstOpportunityService } from "../../../../../../runtime/knowledge-opportunity/service.js";
import { PgOptionalKeywordEnhancementPort } from "../../../../../../runtime/knowledge-opportunity/pg-keyword-enhancement-port.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION = "knowledge_opportunity.command.confirm";

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
  if (!project) return toHttpResponse(apiErr("NOT_FOUND", "未找到项目。"));
  const tenant = { clientOrganizationId: project.clientOrganizationId, projectId: project.id };
  const denied = await denyIfCrossTenant(rt, session, actor, tenant, ACTION, "Opportunity");
  if (denied) return denied;

  const body = await readJsonBody(request);
  const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
  const knowledgePackageId =
    typeof body.knowledgePackageId === "string" ? body.knowledgePackageId.trim() : "";
  if (!candidateId || !knowledgePackageId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "请选择需要确认的用户问题。"));
  }
  const idempotencyKey = readIdempotencyKey(request, body);

  try {
    const { dto } = await runWriteCommand({
      db: rt.db,
      actor,
      action: ACTION,
      idempotencyKey,
      perform: async (ctx) => {
        const geo = createGeoCommandRuntime(ctx.tx);
        const authContext = buildGeoAuthorizationContext(session);
        const grounding = new PgKnowledgeGroundingPort(ctx.tx);
        const service = new KnowledgeFirstOpportunityService(
          grounding,
          new DeterministicKnowledgeOpportunityGenerator(),
          new PgOptionalKeywordEnhancementPort(ctx.tx),
        );
        const batch = await service.generateForProject(authContext, {
          ...tenant,
          knowledgePackageId,
        });
        const candidate = batch.candidates.find((item) => item.id === candidateId);
        if (!candidate) {
          throw new CommandAbortError(
            "CONFLICT",
            "企业知识已发生变化，请重新生成后再确认。",
          );
        }
        const knowledgePackage = await geo.repos.knowledgePackages.getById(knowledgePackageId);
        if (
          !knowledgePackage ||
          knowledgePackage.clientOrganizationId !== tenant.clientOrganizationId ||
          knowledgePackage.projectId !== tenant.projectId
        ) {
          throw new CommandAbortError("NOT_FOUND", "未找到当前项目的知识包。" );
        }
        const industryResult = await ctx.tx.query<{ id: string }>(
          `SELECT id FROM industry_profile
           WHERE client_organization_id=$1 AND project_id=$2 LIMIT 1`,
          [tenant.clientOrganizationId, tenant.projectId],
        );
        const industryProfileId = industryResult.rows[0]?.id;
        if (!industryProfileId) {
          throw new CommandAbortError(
            "CONFLICT",
            "用户问题已生成，但项目行业规则尚未确认；请先联系平台运营完成行业配置，再提交人工确认。",
          );
        }
        const industryProfileResult = await geo.repos.industryProfiles.getById(industryProfileId);
        if (!industryProfileResult) {
          throw new CommandAbortError(
            "CONFLICT",
            "行业配置未找到，请联系平台运营完成行业配置。",
          );
        }
        const connected = await invokeDomain(() =>
          new ExistingOpportunityConnector(
            geo.services.keywordQuestion,
            geo.services.opportunity,
          ).create(authContext, { candidate, knowledgePackage, industryProfileId }),
        );
        const validation = await invokeDomain(() =>
          geo.services.validation.validateOpportunity(authContext, {
            opportunity: connected.opportunity,
            industryProfile: industryProfileResult,
            status: "VALIDATED",
            reasonNote: "Automated validation: knowledge-grounded, on-vertical.",
          }),
        );
        return {
          dto: {
            question: candidate.question,
            status: "CREATED" as const,
            opportunityId: connected.opportunity.id,
            validationId: validation.id,
          },
          audit: {
            ...tenant,
            targetType: "Opportunity",
            targetId: connected.opportunity.id,
            metadata: { source: candidate.source, validationId: validation.id },
          },
        };
      },
    });
    return toHttpResponse(apiOk(dto), { okStatus: 201 });
  } catch (error) {
    if (error instanceof CommandAbortError) return toHttpResponse(error.response);
    throw error;
  }
}
