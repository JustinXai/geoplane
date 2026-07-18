/**
 * GET /api/projects — lists the ProjectViewV1[] the authenticated principal may see:
 *   CLIENT_OWNER  -> projects of their single active client organization
 *   AGENCY_*      -> projects across their ACTIVE-assigned client organizations
 *   PLATFORM      -> projects of a ?clientOrganizationId the admin names (else empty)
 * Unauthenticated -> 401. Server-derived principal only (never trusts client-supplied org ids).
 *
 * Agent A composition glue (CORE_RUNTIME_TRUE_PARALLEL) — the frontend workspace needs a
 * project list; the single-project route already lives under this dir. Reuses the auth
 * runtime's server-side session resolution + repositories.
 */
import { apiErr, apiOk, type ProjectViewV1 } from "../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../runtime/auth/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();

  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  // Resolve the set of client organizations this principal may list projects for.
  let clientOrgIds: string[];
  if (session.role === "CLIENT_OWNER") {
    clientOrgIds = [session.activeClientOrganizationId ?? session.organizationId];
  } else if (session.role === "AGENCY_OWNER" || session.role === "AGENCY_OPERATOR") {
    clientOrgIds = [...session.assignedClientOrganizationIds];
  } else {
    // PLATFORM_SUPER_ADMIN: only the explicitly-named client org (ops screens handle breadth).
    const named = new URL(request.url).searchParams.get("clientOrganizationId");
    clientOrgIds = named ? [named] : [];
  }

  const orgNameCache = new Map<string, string>();
  const views: ProjectViewV1[] = [];
  for (const clientOrgId of clientOrgIds) {
    let orgName = orgNameCache.get(clientOrgId);
    if (orgName === undefined) {
      const org = await rt.repos.organizations.findById(clientOrgId);
      orgName = org?.displayName ?? "";
      orgNameCache.set(clientOrgId, orgName);
    }
    const projects = await rt.repos.projects.listForClient(clientOrgId);
    for (const p of projects) {
      views.push({
        id: p.id,
        name: p.name,
        clientOrganizationId: p.clientOrganizationId,
        clientOrganizationName: orgName,
        createdAt: p.createdAt,
      });
    }
  }

  return toHttpResponse(apiOk(views));
}
