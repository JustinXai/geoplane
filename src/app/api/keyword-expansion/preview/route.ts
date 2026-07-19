import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getGeoRuntime, principalCanReadClientOrganization } from "../../../../runtime/geo/runtime-context.js";
import { KeywordExpansionService } from "../../../../runtime/keyword-expansion/offline-runtime.js";
import { PgExpansionRepository } from "../../../../runtime/keyword-expansion/pg-repository.js";
import type { ExpansionGroupInput } from "../../../../runtime/keyword-expansion/contract.js";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function POST(request:Request):Promise<Response>{
 const rt=getGeoRuntime(); const principal=await rt.resolveSession(request.headers.get("cookie"));
 if(!principal)return toHttpResponse(apiErr("UNAUTHENTICATED","Authentication is required."));
 const body=await readJsonBody(request); const projectId=typeof body.projectId==="string"?body.projectId:"";
 const project=await rt.tenancy.projects.findById(projectId); if(!project)return toHttpResponse(apiErr("NOT_FOUND","Project not found."));
 if(!principalCanReadClientOrganization(principal,project.clientOrganizationId))return toHttpResponse(apiErr("FORBIDDEN","Project access denied."));
 try { const service=new KeywordExpansionService(new PgExpansionRepository(rt.db));
  const batch=await service.preview({clientOrganizationId:project.clientOrganizationId,projectId:project.id,
   requestedByUserId:principal.userId,reason:typeof body.reason==="string"?body.reason:"",
   groups:Array.isArray(body.groups)?body.groups as ExpansionGroupInput[]:[]});
  return toHttpResponse(apiOk(batch),{okStatus:201});
 } catch(error){return toHttpResponse(apiErr("VALIDATION_FAILED",error instanceof Error?error.message:"Invalid expansion request."));}
}
