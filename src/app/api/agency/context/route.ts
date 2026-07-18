/**
 * POST /api/agency/context — selects the client an agency session acts for. Emits an audit event
 * (ALLOWED on success, DENIED on an unauthorized/forbidden selection) regardless of outcome.
 * Unauthenticated -> 401.
 *
 * Checkpoint ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 */
import { apiErr } from "../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const body = await readJsonBody(request);
  const clientOrganizationId =
    typeof body.clientOrganizationId === "string" ? body.clientOrganizationId : null;
  if (!clientOrganizationId) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "clientOrganizationId is required."),
    );
  }

  const now = new Date();
  const result = await rt.authService.setAgencyContext(session, clientOrganizationId);
  await rt.persistAuditIntents(result.auditIntents, now);
  return toHttpResponse(result.response);
}
