import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { principalCanReadClientOrganization, getGeoRuntime } from "../../../../runtime/geo/runtime-context.js";
import {
  ManualProbeService, PgRawProbeResultRepository, ProbeValidationError,
  type ManualProbeSampleInput,
} from "../../../../runtime/probes/manual-sample.js";
import { isConfirmedManualProbeQuestion } from "../../../../runtime/read-models/domestic-workspaces.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requestContext(request: Request, projectId: string) {
  const rt = getGeoRuntime();
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) return { response: toHttpResponse(apiErr("UNAUTHENTICATED", "请先登录后再操作。")) } as const;
  const project = await rt.tenancy.projects.findById(projectId);
  if (!project) return { response: toHttpResponse(apiErr("NOT_FOUND", "未找到该项目。")) } as const;
  if (!principalCanReadClientOrganization(principal, project.clientOrganizationId)) {
    return { response: toHttpResponse(apiErr("FORBIDDEN", "你无权访问该项目的国内 AI 检测记录。")) } as const;
  }
  return { rt, principal, project } as const;
}

export async function GET(request: Request): Promise<Response> {
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() ?? "";
  if (!projectId) return toHttpResponse(apiErr("VALIDATION_FAILED", "请选择项目。"));
  const context = await requestContext(request, projectId);
  if ("response" in context && context.response) return context.response;
  const repository = new PgRawProbeResultRepository(context.rt.db);
  return toHttpResponse(apiOk(await repository.listByProject(context.project.clientOrganizationId, projectId)));
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!projectId) return toHttpResponse(apiErr("VALIDATION_FAILED", "请选择项目。"));
  const context = await requestContext(request, projectId);
  if ("response" in context && context.response) return context.response;
  try {
    const input = { ...body, projectId: context.project.id, clientOrganizationId: context.project.clientOrganizationId } as unknown as ManualProbeSampleInput;
    if (typeof body.question !== "string" || !await isConfirmedManualProbeQuestion(
      context.rt.db, context.project.clientOrganizationId, context.project.id, body.question,
    )) {
      return toHttpResponse(apiErr("VALIDATION_FAILED", "只能登记该项目已由人工确认的用户问题。"));
    }
    const service = new ManualProbeService(new PgRawProbeResultRepository(context.rt.db));
    return toHttpResponse(apiOk(await service.record(input, context.principal.userId)), { okStatus: 201 });
  } catch (error) {
    if (error instanceof ProbeValidationError) {
      return toHttpResponse(apiErr("VALIDATION_FAILED", "国内 AI 检测样本信息不完整或不符合要求。"));
    }
    throw error;
  }
}
