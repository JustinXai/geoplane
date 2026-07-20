import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { principalCanReadClientOrganization, getGeoRuntime } from "../../../../runtime/geo/runtime-context.js";
import { DetectionRunService } from "../../../../runtime/detection-run/service.js";
import type { DetectionRunCreate } from "../../../../runtime/detection-run/contracts.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rt = getGeoRuntime();
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "请先登录后再操作。"));
  }

  const body = await request.json() as Record<string, unknown>;

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const questions = Array.isArray(body.questions) ? body.questions.filter((q): q is string => typeof q === "string") : [];
  const platforms = Array.isArray(body.platforms) ? body.platforms.filter((p): p is string => typeof p === "string") : [];

  if (!projectId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "projectId 为必填项。"));
  }
  if (!name) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "name 为必填项。"));
  }
  if (questions.length === 0) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "questions 至少需要一项。"));
  }
  if (platforms.length === 0) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "platforms 至少需要一项。"));
  }

  const project = await rt.tenancy.projects.findById(projectId);
  if (!project) {
    return toHttpResponse(apiErr("NOT_FOUND", "未找到该项目。"));
  }

  if (!principalCanReadClientOrganization(principal, project.clientOrganizationId)) {
    return toHttpResponse(apiErr("FORBIDDEN", "你无权访问该项目。"));
  }

  const input: DetectionRunCreate = {
    projectId: project.id,
    clientOrganizationId: project.clientOrganizationId,
    name,
    questions,
    platforms,
    createdByUserId: principal.userId,
  };

  const service = new DetectionRunService(rt.db);
  const run = await service.createRun(input);

  return toHttpResponse(apiOk(run), { okStatus: 201 });
}
