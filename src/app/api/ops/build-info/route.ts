import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import { readBuildInfo } from "../../../../runtime/observability/build-info.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = getAuthRuntime();
  const session = await auth.resolveSession(request.headers.get("cookie"));
  if (!session) return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  if (session.role !== "PLATFORM_SUPER_ADMIN") {
    return toHttpResponse(apiErr("FORBIDDEN", "Only a platform administrator may read build information."));
  }
  return toHttpResponse(apiOk(readBuildInfo()));
}
