import { apiErr } from "../api-contracts/index.js";
import { toHttpResponse } from "../auth/http.js";
import { getGeoRuntime, principalCanReadClientOrganization } from "../geo/runtime-context.js";

export async function requireReadableWorkspaceProject(request:Request,projectId:string){
  const runtime=getGeoRuntime(); const principal=await runtime.resolveSession(request.headers.get("cookie"));
  if(!principal)return {response:toHttpResponse(apiErr("UNAUTHENTICATED","Authentication is required."))} as const;
  const project=await runtime.tenancy.projects.findById(projectId);
  if(!project)return {response:toHttpResponse(apiErr("NOT_FOUND","Project not found."))} as const;
  if(!principalCanReadClientOrganization(principal,project.clientOrganizationId))return {response:toHttpResponse(apiErr("FORBIDDEN","Project access denied."))} as const;
  return {value:{runtime,principal,project}} as const;
}
