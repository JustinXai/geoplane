import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../runtime/auth/http.js";
import { principalCanReadClientOrganization, getGeoRuntime } from "../../../../../runtime/geo/runtime-context.js";
import { DetectionRunService } from "../../../../../runtime/detection-run/service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const rt = getGeoRuntime();
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "请先登录后再操作。"));
  }

  const { runId } = await context.params;
  if (!runId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "runId 为必填项。"));
  }

  const service = new DetectionRunService(rt.db);
  const run = await service.getRun(runId);

  if (!run) {
    return toHttpResponse(apiErr("NOT_FOUND", "未找到该检测运行。"));
  }

  if (!principalCanReadClientOrganization(principal, run.clientOrganizationId)) {
    return toHttpResponse(apiErr("FORBIDDEN", "你无权访问该检测运行。"));
  }

  return toHttpResponse(apiOk(run));
}
