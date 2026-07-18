/**
 * Shared request-layer preamble for the GEO business-chain command routes (Agent C — batch 2).
 *
 * Two helpers every geo command route runs before opening its write transaction:
 *   - requireSession — cookie -> server-resolved AuthenticatedSession, or a ready 401 Response.
 *   - denyIfCrossTenant — the pre-flight tenant check: if the session may not write for the
 *     server-resolved tenant, persist a DENIED audit event (real actor) and return a 403 Response;
 *     otherwise null. This is the cross-tenant guard done BEFORE the transaction so no partial work
 *     happens and the denial is durably recorded even though nothing is written.
 */
import { apiErr } from "../api-contracts/index.js";
import { toHttpResponse } from "../auth/http.js";
import type { AuthenticatedSession } from "../auth/auth-service.js";
import type { AuthRuntime } from "../auth/runtime-context.js";
import { recordDeniedCommand, type CommandActor } from "./runtime-context.js";
import { sessionCanAccessClientOrganization } from "./geo-command-runtime.js";

export interface GeoTenant {
  readonly clientOrganizationId: string;
  readonly projectId: string;
}

/** Narrows the `Session | Response` union the route preamble returns. */
export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** Resolves the cookie to a server-derived session, or a ready-to-return 401 Response. */
export async function requireSession(
  rt: AuthRuntime,
  request: Request,
): Promise<AuthenticatedSession | Response> {
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }
  return session;
}

/**
 * Cross-tenant guard. Returns null when the session may write for `tenant`; otherwise records a
 * DENIED audit event for the real actor and returns a 403 Response. The tenant is always the
 * server-resolved one (from the session or the referenced artifact), never a body value.
 */
export async function denyIfCrossTenant(
  rt: AuthRuntime,
  session: AuthenticatedSession,
  actor: CommandActor,
  tenant: GeoTenant,
  action: string,
  targetType: string,
): Promise<Response | null> {
  if (sessionCanAccessClientOrganization(session, tenant.clientOrganizationId)) {
    return null;
  }
  await recordDeniedCommand(rt.db, actor, action, {
    clientOrganizationId: tenant.clientOrganizationId,
    projectId: tenant.projectId,
    targetType,
  });
  return toHttpResponse(
    apiErr("FORBIDDEN", "You are not authorized to write for this tenant."),
  );
}
