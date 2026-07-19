import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { DeterministicKnowledgeOpportunityGenerator } from "../../../../../../runtime/knowledge-opportunity/offline-generator.js";
import { PgKnowledgeGroundingPort } from "../../../../../../runtime/knowledge-opportunity/pg-grounding-port.js";
import type { OptionalKeywordSeed } from "../../../../../../runtime/knowledge-opportunity/contracts.js";
import { requireReadableWorkspaceProject } from "../../../../../../runtime/read-models/http-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readSeeds(value: unknown): OptionalKeywordSeed[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 100) throw new Error("一次最多使用 100 个可选关键词");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("关键词格式不正确");
    const item = raw as Record<string, unknown>;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const origin = item.origin === "MANUAL" || item.origin === "DATASET" ? item.origin : null;
    if (!text || !origin) throw new Error("关键词文本和来源不能为空");
    // Browser input is a seed only. Demand evidence is never accepted from an untrusted body.
    return {
      text,
      origin,
      ...(typeof item.sourceRef === "string" && item.sourceRef.trim()
        ? { sourceRef: item.sourceRef.trim() }
        : {}),
    };
  });
}

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
    const batch = new DeterministicKnowledgeOpportunityGenerator().generate({
      ...snapshot,
      optionalKeywordSeeds: readSeeds(body.optionalKeywordSeeds),
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
