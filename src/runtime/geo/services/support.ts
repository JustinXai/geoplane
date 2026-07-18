/**
 * GEO_RUNTIME_SERVICE_PORTS_V1 — shared service support.
 *
 * Common infrastructure bundle every application service depends on, plus the
 * single audit-emitting helper so every service records through the exact same
 * shape/convention. Nothing here reimplements business logic — that lives in
 * the frozen pure functions in src/contracts/geo-business/entities.ts.
 */
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type { AuditPort, Clock, IdFactory } from "../ports.js";

/**
 * The three cross-cutting ports every service needs: a deterministic clock, a
 * deterministic id source, and an audit sink. Bundled so service constructors
 * stay readable while still receiving every dependency explicitly.
 */
export interface GeoRuntimeInfra {
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly audit: AuditPort;
}

/**
 * Emit exactly one append-only audit intent for a state-changing action.
 * The actor identity is taken from the server-resolved AuthorizationContext,
 * never from caller-supplied fields — same discipline as the frozen
 * authorization module (identity always comes from `ctx`).
 */
export async function emitAudit(
  infra: GeoRuntimeInfra,
  actor: AuthorizationContext,
  scope: { clientOrganizationId: string; projectId: string },
  action: string,
  targetType: string,
  targetId: string,
  occurredAt: string,
): Promise<void> {
  await infra.audit.record({
    actorUserId: actor.actorUserId,
    actorOrganizationId: actor.organizationId,
    clientOrganizationId: scope.clientOrganizationId,
    projectId: scope.projectId,
    action,
    targetType,
    targetId,
    occurredAt,
  });
}
