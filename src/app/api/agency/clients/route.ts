/**
 * GET /api/agency/clients — returns the ACTIVE-assigned client portfolio for an agency session.
 * Non-agency roles get 403; unauthenticated callers get 401.
 *
 * Checkpoint ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 */
import { apiErr } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }
  return toHttpResponse(await rt.authService.listAgencyClients(session));
}
