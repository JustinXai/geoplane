import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { principalCanReadClientOrganization, getGeoRuntime } from "../../../../runtime/geo/runtime-context.js";
import {
  ManualProbeService, PgRawProbeResultRepository, ProbeValidationError,
  type ManualProbeSampleInput,
} from "../../../../runtime/probes/manual-sample.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rt = getGeoRuntime();
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  const body = await readJsonBody(request);
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const project = await rt.tenancy.projects.findById(projectId);
  if (!project) return toHttpResponse(apiErr("NOT_FOUND", "Project not found."));
  if (!principalCanReadClientOrganization(principal, project.clientOrganizationId)) {
    return toHttpResponse(apiErr("FORBIDDEN", "You are not authorized to record this project."));
  }
  try {
    const input = { ...body, projectId: project.id, clientOrganizationId: project.clientOrganizationId } as unknown as ManualProbeSampleInput;
    const service = new ManualProbeService(new PgRawProbeResultRepository(rt.db));
    return toHttpResponse(apiOk(await service.record(input, principal.userId)), { okStatus: 201 });
  } catch (error) {
    if (error instanceof ProbeValidationError) {
      return toHttpResponse(apiErr("VALIDATION_FAILED", error.message));
    }
    throw error;
  }
}
