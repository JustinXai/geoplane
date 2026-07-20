import { apiErr, apiOk } from "../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getGeoRuntime } from "../../../../../runtime/geo/runtime-context.js";
import { DetectionRunService } from "../../../../../runtime/detection-run/service.js";
import type { DetectionTaskStatus } from "../../../../../runtime/detection-run/contracts.js";

const VALID_TASK_STATUSES: readonly DetectionTaskStatus[] = [
  "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "MANUAL_REQUIRED",
];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const rt = getGeoRuntime();
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "请先登录后再操作。"));
  }

  const { taskId } = await context.params;
  if (!taskId) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "taskId 为必填项。"));
  }

  const body = await request.json() as Record<string, unknown>;

  const status = typeof body.status === "string" ? body.status : "";
  if (!VALID_TASK_STATUSES.includes(status as DetectionTaskStatus)) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", `status 必须是以下值之一: ${VALID_TASK_STATUSES.join(", ")}`));
  }

  const result: { answerText?: string; failureCode?: string; failureMessage?: string } = {};
  if (typeof body.answerText === "string") {
    result.answerText = body.answerText;
  }
  if (typeof body.failureCode === "string") {
    result.failureCode = body.failureCode;
  }
  if (typeof body.failureMessage === "string") {
    result.failureMessage = body.failureMessage;
  }

  const service = new DetectionRunService(rt.db);

  try {
    const task = await service.updateTaskResult(taskId, result, status as DetectionTaskStatus);
    await service.finalizeRun(task.runId);
    const updated = await service.getRun(task.runId);
    return toHttpResponse(apiOk(updated));
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return toHttpResponse(apiErr("NOT_FOUND", "未找到该检测任务。"));
    }
    throw error;
  }
}
