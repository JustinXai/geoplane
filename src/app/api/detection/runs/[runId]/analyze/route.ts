/**
 * Detection run analysis endpoints.
 * - POST: triggers brand-matching analysis for a detection run
 * - GET: retrieves observations for a detection run
 *
 * Requires session auth + cross-tenant check.
 */
import { apiErr, apiOk } from "@/runtime/api-contracts/index.js";
import { toHttpResponse, readJsonBody } from "@/runtime/auth/http.js";
import {
  getGeoRuntime,
  principalCanReadClientOrganization,
} from "@/runtime/geo/runtime-context.js";
import {
  PgDetectionObservationRepository,
  listDetectionTasksByRun,
  getDetectionRun,
} from "@/runtime/detection-analysis/repository.js";
import { DetectionAnalysisService } from "@/runtime/detection-analysis/service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeRequestBody {
  readonly brandName: string;
  readonly brandAliases?: string[];
  readonly competitorNames?: string[];
}

async function requestContext(request: Request, runId: string) {
  const rt = getGeoRuntime();
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) {
    return { response: toHttpResponse(apiErr("UNAUTHENTICATED", "请先登录后再操作。")) as Response } as const;
  }

  const run = await getDetectionRun(rt.db, runId);
  if (!run) {
    return { response: toHttpResponse(apiErr("NOT_FOUND", "未找到该检测任务运行记录。")) as Response } as const;
  }

  if (!principalCanReadClientOrganization(principal, run.clientOrganizationId)) {
    return { response: toHttpResponse(apiErr("FORBIDDEN", "你无权访问该项目的数据。")) as Response } as const;
  }

  return { rt, principal, run } as const;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;

  const ctx = await requestContext(request, runId);
  const resp = ctx.response;
  if (resp) return resp;

  const body = await readJsonBody(request) as Partial<AnalyzeRequestBody>;
  if (typeof body.brandName !== "string" || body.brandName.trim().length === 0) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "brandName 为必填项。"));
  }

  const tasks = await listDetectionTasksByRun(ctx.rt.db, runId);

  const observationRepo = new PgDetectionObservationRepository(ctx.rt.db);
  const service = new DetectionAnalysisService();

  const result = service.analyzeRun({
    runId,
    brandName: body.brandName.trim(),
    brandAliases: Array.isArray(body.brandAliases) ? body.brandAliases : [],
    competitorNames: Array.isArray(body.competitorNames) ? body.competitorNames : [],
    tasks,
  });

  // Persist each observation
  for (const observation of result.observations) {
    await observationRepo.append(observation);
  }

  return toHttpResponse(apiOk(result), { okStatus: 201 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;

  const ctx = await requestContext(request, runId);
  const resp = ctx.response;
  if (resp) return resp;

  const observationRepo = new PgDetectionObservationRepository(ctx.rt.db);
  const observations = await observationRepo.listByRun(runId);

  return toHttpResponse(apiOk(observations));
}
