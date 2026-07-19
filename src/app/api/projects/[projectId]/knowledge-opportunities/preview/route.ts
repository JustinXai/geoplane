import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { DeterministicKnowledgeOpportunityGenerator } from "../../../../../../runtime/knowledge-opportunity/offline-generator.js";
import { PgKnowledgeGroundingPort } from "../../../../../../runtime/knowledge-opportunity/pg-grounding-port.js";
import { PgOptionalKeywordEnhancementPort } from "../../../../../../runtime/knowledge-opportunity/pg-keyword-enhancement-port.js";
import { requireReadableWorkspaceProject } from "../../../../../../runtime/read-models/http-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const { projectId } = await context.params;
  const readable = await requireReadableWorkspaceProject(request, projectId);
  if ("response" in readable) return readable.response!;
  const { runtime: rt, project } = readable.value;
  const grounding = new PgKnowledgeGroundingPort(rt.db);
  const body = await readJsonBody(request);
  try {
    const packageId =
      typeof body.knowledgePackageId === "string" && body.knowledgePackageId.trim()
        ? body.knowledgePackageId.trim()
        : await grounding.findLatestPackageId({
            clientOrganizationId: project.clientOrganizationId,
            projectId: project.id,
          });
    if (!packageId) {
      return toHttpResponse(
        apiErr("VALIDATION_FAILED", "请先在企业知识库中建立可用资料，再生成用户问题。"),
      );
    }
    const snapshot = await grounding.load({
      clientOrganizationId: project.clientOrganizationId,
      projectId: project.id,
      knowledgePackageId: packageId,
    });
    if (!snapshot) return toHttpResponse(apiErr("NOT_FOUND", "未找到当前项目的知识包。"));
    const optionalKeywordSeeds = await new PgOptionalKeywordEnhancementPort(rt.db).load({
      clientOrganizationId: project.clientOrganizationId,
      projectId: project.id,
    });
    const batch = new DeterministicKnowledgeOpportunityGenerator().generate({
      ...snapshot,
      optionalKeywordSeeds,
    });
    return toHttpResponse(apiOk(batch));
  } catch (error) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        error instanceof Error ? error.message : "企业知识暂时无法生成用户问题。",
      ),
    );
  }
}
