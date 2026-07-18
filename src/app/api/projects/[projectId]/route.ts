/**
 * GET /api/projects/[projectId] — reads a ProjectViewV1 with tenant/authorization checks.
 * Cross-tenant access is FORBIDDEN (403) and writes a DENIED audit event. Unauthenticated -> 401.
 *
 * Checkpoint ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 *
 * Boundary note: /api/projects is not in this lane's exclusive dir list, but it is the thin
 * wiring around this lane's AuthService.getProject (project-access tenant isolation is core auth
 * logic) and is explicitly enumerated in the checkpoint scope. No other lane had created an
 * src/app/api tree when this was added.
 */
import { apiErr } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { projectId } = await context.params;

  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const now = new Date();
  const result = await rt.authService.getProject(session, projectId);
  await rt.persistAuditIntents(result.auditIntents, now);
  return toHttpResponse(result.response);
}
