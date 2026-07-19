import { apiErr,apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { getGeoRuntime } from "../../../../runtime/geo/runtime-context.js";
import { readManualProbeEntryOptions } from "../../../../runtime/read-models/domestic-workspaces.js";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){const rt=getGeoRuntime();const principal=await rt.resolveSession(request.headers.get("cookie"));if(!principal)return toHttpResponse(apiErr("UNAUTHENTICATED","请先登录后再查看国内 AI 检测。"));return toHttpResponse(apiOk(await readManualProbeEntryOptions(rt.db,principal)))}
