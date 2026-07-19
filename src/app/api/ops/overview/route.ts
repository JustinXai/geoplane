import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { getGeoRuntime } from "../../../../runtime/geo/runtime-context.js";
import { readPlatformOpsOverview } from "../../../../runtime/read-models/platform-ops-overview.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rt = getGeoRuntime();
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) return toHttpResponse(apiErr("UNAUTHENTICATED", "请先登录后再查看平台运营总览。"));
  if (principal.role !== "PLATFORM_SUPER_ADMIN") return toHttpResponse(apiErr("FORBIDDEN", "仅平台运营管理员可以查看平台汇总。"));
  return toHttpResponse(apiOk(await readPlatformOpsOverview(rt.db, principal, rt.geo.reads)));
}
