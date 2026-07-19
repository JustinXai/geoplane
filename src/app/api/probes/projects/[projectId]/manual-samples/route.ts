import { apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { readManualProbeSamples } from "../../../../../../runtime/read-models/domestic-workspaces.js";
import { requireReadableWorkspaceProject } from "../../../../../../runtime/read-models/http-context.js";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{projectId:string}>}){const {projectId}=await context.params;const ctx=await requireReadableWorkspaceProject(request,projectId);if("response" in ctx)return ctx.response;return toHttpResponse(apiOk(await readManualProbeSamples(ctx.value.runtime.db,ctx.value.project.clientOrganizationId,ctx.value.project.id)))}
