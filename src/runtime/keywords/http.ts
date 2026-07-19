import { randomUUID } from "node:crypto";
import { apiErr } from "../api-contracts/index.js";
import { toHttpResponse } from "../auth/http.js";
import { requirePrincipal,requireReadableProject } from "../geo/http-guards.js";
import { getGeoRuntime } from "../geo/runtime-context.js";
import { PgKeywordRuntimeRepository } from "./pg-repository.js";

export async function keywordRequestContext(request:Request,projectId:string){
  const runtime=getGeoRuntime();const principal=await requirePrincipal(runtime,request);if("response" in principal)return principal;
  const project=await requireReadableProject(runtime,principal.value,projectId);if("response" in project)return project;
  return {value:{runtime,principal:principal.value,project:project.value,repo:new PgKeywordRuntimeRepository(runtime.db),ids:{next:()=>randomUUID()},now:()=>new Date().toISOString()}};
}
export function invalid(message:string){return toHttpResponse(apiErr("VALIDATION_FAILED",message));}
