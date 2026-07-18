/**
 * GET /api/ops/organizations — the Ops workspace's organization directory: every organization
 * as OrganizationSummaryV1[], newest first. PLATFORM_SUPER_ADMIN only; any other role -> 403.
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 1). Role is derived from the resolved session.
 */
import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import { listAllOrganizations } from "../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }
  if (session.role !== "PLATFORM_SUPER_ADMIN") {
    return toHttpResponse(
      apiErr("FORBIDDEN", "Only a platform super admin may list organizations."),
    );
  }

  const organizations = await listAllOrganizations(rt.db);
  return toHttpResponse(apiOk(organizations));
}
