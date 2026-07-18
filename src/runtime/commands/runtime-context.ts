/**
 * Lane-local command runtime for BUSINESS_COMMAND_API_V1 (Agent C — batch 1).
 *
 * This is the write-side counterpart to src/runtime/auth/runtime-context.ts. It does NOT build
 * its own database/singleton (the command routes reuse getAuthRuntime() for cookie->session
 * resolution and the shared DatabasePort); it only provides the three things a command handler
 * needs on top of the frozen core:
 *
 *   1. runWriteCommand — runs a create inside ONE transaction (withRepositories semantics),
 *      writes exactly one ALLOWED AuditEvent for it, and enforces Idempotency-Key so a retried
 *      create returns the first result instead of writing a second entity.
 *   2. recordDeniedCommand — persists a DENIED AuditEvent (real actor from the session) for a
 *      wrong-role / cross-tenant write attempt, in its own transaction, before the route 403s.
 *   3. read helpers (listAllOrganizations / listRecentAuditViews) the Ops workspace needs.
 *
 * Server-side tenant resolution (SYSTEM_INVARIANTS_V1.md): the actor (userId + organizationId)
 * passed to every helper here is ALWAYS derived from the resolved session by the route, never
 * from request input. Nothing in this module reads a caller-supplied organization id.
 *
 * Idempotency mechanism: the append-only audit_event trail doubles as the idempotency ledger.
 * A successful command stores its Idempotency-Key and its result DTO in the event metadata; a
 * retry with the same (actorUserId, action, key) finds that prior ALLOWED event and replays the
 * stored DTO without touching any table. This reuses existing infrastructure rather than adding
 * a migration (out of this lane's scope). It makes sequential client retries — the common case —
 * yield exactly one entity; org creation is additionally hardened at the DB level by the
 * organization idempotency_key unique index (see runWriteCommand callers).
 */
import { recordAuditEvent } from "../../contracts/tenancy/audit.js";
import type { PlatformRole } from "../../contracts/tenancy/entities.js";
import type { DatabasePort, Queryable } from "../../persistence/database-port.js";
import {
  createRepositories,
  type Repositories,
} from "../../persistence/repository-factory.js";
import {
  apiErr,
  type ApiErrorCodeV1,
  type ApiErrorV1,
  type AuditEventViewV1,
} from "../api-contracts/index.js";
import type { OrganizationSummaryV1 } from "./dto.js";

export type CommandOutcome = "ALLOWED" | "DENIED";

/**
 * Thrown from inside a `perform` closure to abort the command with a specific error envelope
 * (e.g. NOT_FOUND, CONFLICT) *before* any ALLOWED audit is written. Because it propagates out of
 * the transaction, the whole unit rolls back — no half-created entity, no spurious audit row.
 * The route turns it back into an HTTP response via `toHttpResponse(err.response)`.
 */
export class CommandAbortError extends Error {
  readonly response: ApiErrorV1;
  constructor(code: ApiErrorCodeV1, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CommandAbortError";
    this.response = apiErr(code, message, details);
  }
}

/** The server-derived actor for a command. Both fields come from the resolved session only. */
export interface CommandActor {
  readonly userId: string;
  readonly organizationId: string;
}

/** The identifying fields of the AuditEvent a command emits (outcome + metadata are added here). */
export interface CommandAuditFields {
  readonly clientOrganizationId?: string | null;
  readonly projectId?: string | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/** Context handed to a command's `perform` closure — bound to the live transaction. */
export interface CommandContext {
  readonly repos: Repositories;
  readonly tx: Queryable;
  readonly now: Date;
  readonly actor: CommandActor;
}

/** What a command's `perform` returns: the DTO to send back plus the audit fields for the event. */
export interface CommandResult<T> {
  readonly dto: T;
  readonly audit: CommandAuditFields;
}

export interface WriteCommandInput<T> {
  readonly db: DatabasePort;
  readonly actor: CommandActor;
  /** Stable action name (also the idempotency-ledger key namespace), e.g. "ops.agency.create". */
  readonly action: string;
  /** The client-supplied Idempotency-Key (header or body), or null when none was provided. */
  readonly idempotencyKey: string | null;
  /** Runs inside the transaction; must not be called on an idempotent replay. */
  readonly perform: (ctx: CommandContext) => Promise<CommandResult<T>>;
}

export interface WriteCommandOutcome<T> {
  readonly replayed: boolean;
  readonly dto: T;
}

/** Appends one AuditEvent inside the given transaction's repositories. */
async function appendAudit(
  repos: Repositories,
  actor: CommandActor,
  action: string,
  outcome: CommandOutcome,
  fields: CommandAuditFields,
  now: Date,
): Promise<void> {
  // The audit_event schema has no dedicated outcome column, so ALLOWED/DENIED lives in the
  // (hashed, persisted) metadata bag — matching persistAuditIntents in the auth runtime.
  const metadata: Record<string, unknown> = { ...(fields.metadata ?? {}), outcome };
  const event = recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorOrganizationId: actor.organizationId,
    clientOrganizationId: fields.clientOrganizationId ?? null,
    projectId: fields.projectId ?? null,
    action,
    targetType: fields.targetType ?? null,
    targetId: fields.targetId ?? null,
    metadata,
    now,
  });
  await repos.auditEvents.append({
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

/** Looks up the result DTO of a prior ALLOWED command with the same (actor, action, key). */
async function findIdempotentReplay(
  tx: Queryable,
  actorUserId: string,
  action: string,
  idempotencyKey: string,
): Promise<unknown | null> {
  const res = await tx.query<{ metadata: Record<string, unknown> | null }>(
    `SELECT metadata FROM audit_event
     WHERE actor_user_id = $1 AND action = $2
       AND metadata->>'idempotencyKey' = $3
       AND metadata->>'outcome' = 'ALLOWED'
     ORDER BY created_at ASC
     LIMIT 1`,
    [actorUserId, action, idempotencyKey],
  );
  const row = res.rows[0];
  if (!row || !row.metadata) return null;
  const result = row.metadata["result"];
  return result === undefined ? null : result;
}

/**
 * Runs a create command atomically: idempotency short-circuit, then `perform`, then exactly one
 * ALLOWED AuditEvent — all in the same transaction, so a failure rolls the whole unit back.
 */
export async function runWriteCommand<T>(
  input: WriteCommandInput<T>,
): Promise<WriteCommandOutcome<T>> {
  return input.db.transaction(async (tx): Promise<WriteCommandOutcome<T>> => {
    const repos = createRepositories(tx);
    const now = new Date();

    if (input.idempotencyKey) {
      const prior = await findIdempotentReplay(
        tx,
        input.actor.userId,
        input.action,
        input.idempotencyKey,
      );
      if (prior !== null) {
        return { replayed: true, dto: prior as T };
      }
    }

    const { dto, audit } = await input.perform({ repos, tx, now, actor: input.actor });

    const metadata: Record<string, unknown> = { ...(audit.metadata ?? {}), result: dto };
    if (input.idempotencyKey) metadata["idempotencyKey"] = input.idempotencyKey;

    await appendAudit(
      repos,
      input.actor,
      input.action,
      "ALLOWED",
      { ...audit, metadata },
      now,
    );

    return { replayed: false, dto };
  });
}

/**
 * Persists a DENIED AuditEvent for a rejected write (wrong role / cross-tenant / not authorized),
 * in its own transaction. The actor is the real, session-derived principal — the whole point is
 * to record WHO was denied.
 */
export async function recordDeniedCommand(
  db: DatabasePort,
  actor: CommandActor,
  action: string,
  fields: CommandAuditFields,
): Promise<void> {
  await db.transaction(async (tx) => {
    const repos = createRepositories(tx);
    await appendAudit(repos, actor, action, "DENIED", fields, new Date());
  });
}

// ---------------------------------------------------------------------------
// Ops read helpers (PLATFORM-only surfaces; the route enforces the role)
// ---------------------------------------------------------------------------

interface OrganizationRow {
  id: string;
  type: OrganizationSummaryV1["type"];
  display_name: string;
  status: OrganizationSummaryV1["status"];
  created_at: Date;
}

/** Every organization, newest first — the Ops workspace's org directory. */
export async function listAllOrganizations(
  db: DatabasePort,
): Promise<OrganizationSummaryV1[]> {
  const res = await db.query<OrganizationRow>(
    `SELECT id, type, display_name, status, created_at
     FROM organization
     ORDER BY created_at DESC, id`,
  );
  return res.rows.map((row) => ({
    id: row.id,
    type: row.type,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  }));
}

interface AuditViewRow {
  id: string;
  action: string;
  actor_email: string | null;
  client_organization_id: string | null;
  project_id: string | null;
  target_type: string | null;
  created_at: Date;
}

/**
 * The most recent audit trail across every tenant as AuditEventViewV1[] — the Ops audit surface.
 * actorDisplayName is the actor's email (the only human-facing identifier the user table carries).
 */
export async function listRecentAuditViews(
  db: DatabasePort,
  limit = 100,
): Promise<AuditEventViewV1[]> {
  const res = await db.query<AuditViewRow>(
    `SELECT a.id,
            a.action,
            u.email AS actor_email,
            a.client_organization_id,
            a.project_id,
            a.target_type,
            a.created_at
     FROM audit_event a
     LEFT JOIN "user" u ON u.id = a.actor_user_id
     ORDER BY a.created_at DESC, a.id
     LIMIT $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorDisplayName: row.actor_email,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    targetType: row.target_type,
    occurredAt: row.created_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Shared request helpers
// ---------------------------------------------------------------------------

/**
 * Extracts an Idempotency-Key from the request: the `Idempotency-Key` header takes precedence,
 * falling back to a body `idempotencyKey` field. Returns null when neither is present/usable.
 */
export function readIdempotencyKey(
  request: Request,
  body: Record<string, unknown>,
): string | null {
  const header = request.headers.get("idempotency-key");
  if (header && header.trim() !== "") return header.trim();
  const fromBody = body["idempotencyKey"];
  if (typeof fromBody === "string" && fromBody.trim() !== "") return fromBody.trim();
  return null;
}

/** Reads a required non-blank string field from a parsed body, or null if absent/blank. */
export function readStringField(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Narrows an unknown role-ish string to a PlatformRole, or null. */
export function asPlatformRole(value: unknown): PlatformRole | null {
  return value === "PLATFORM_SUPER_ADMIN" ||
    value === "AGENCY_OWNER" ||
    value === "AGENCY_OPERATOR" ||
    value === "CLIENT_OWNER"
    ? value
    : null;
}
