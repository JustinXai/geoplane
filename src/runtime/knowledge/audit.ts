/**
 * Knowledge-lane audit helper (checkpoint KNOWLEDGE_AUDIT_CLOSURE_V1 — Agent C).
 *
 * The legacy knowledge HTTP routes (file upload, url import, package confirm, issue resolve,
 * snapshot create) persist domain rows but historically wrote NO AuditEvent — the audit gap the
 * new command routes close via geo-command-runtime. This helper closes it for the legacy routes
 * WITHOUT reaching into another lane: it reuses the frozen domain `recordAuditEvent` (hashing) and
 * the shared `PgAuditEventRepository.append` (persistence) directly.
 *
 * SYSTEM_INVARIANTS_V1: the actor and the owning organization are taken from the server-derived
 * `KnowledgePrincipal` (the resolved session), and the client-org / project from the loaded
 * resource — NEVER from request input. Mirrors the command runtime's audit shape:
 *   organizationId === actorOrganizationId === principal.organizationId (the session org), with
 *   clientOrganizationId / projectId scoping the event to the resource's tenant.
 *
 * `queryable` is a `Queryable`, so a caller may pass either the pooled DatabasePort (audit in the
 * same request, right after the write) OR a live TransactionPort (audit in the SAME transaction as
 * the write, so a failure rolls both back). Each call appends exactly one row — callers invoke it
 * once per operation, so a single write is never double-audited.
 */
import { recordAuditEvent } from "../../contracts/tenancy/audit.js";
import type { Queryable } from "../../persistence/database-port.js";
import { PgAuditEventRepository } from "../../persistence/pg/audit-event-repository.js";
import type { KnowledgePrincipal } from "./runtime-context.js";

export interface KnowledgeAuditInput {
  /** Stable, operation-specific action name, e.g. "knowledge_package.confirmed". */
  readonly action: string;
  /** The resource's owning client organization (server-derived from the loaded resource). */
  readonly clientOrganizationId: string;
  /** The resource's project (server-derived), or null when not project-scoped. */
  readonly projectId: string | null;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata?: Record<string, unknown> | null;
  /** Test seam: fix the event time. Defaults to now(). */
  readonly now?: Date;
}

/**
 * Append exactly one hashed AuditEvent for a knowledge write, attributed to `principal`. Persist
 * it through `queryable` (pool or transaction). Returns nothing — the append either succeeds or
 * throws (never swallow: a lost audit must surface, not be hidden).
 */
export async function recordKnowledgeAudit(
  queryable: Queryable,
  principal: KnowledgePrincipal,
  input: KnowledgeAuditInput,
): Promise<void> {
  const event = recordAuditEvent({
    organizationId: principal.organizationId,
    actorUserId: principal.userId,
    actorOrganizationId: principal.organizationId,
    clientOrganizationId: input.clientOrganizationId,
    projectId: input.projectId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? null,
    now: input.now ?? new Date(),
  });

  await new PgAuditEventRepository(queryable).append({
    organizationId: event.organizationId,
    actorUserId: event.actorUserId,
    actorOrganizationId: event.actorOrganizationId,
    clientOrganizationId: event.clientOrganizationId,
    projectId: event.projectId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata,
    eventHash: event.eventHash,
  });
}
