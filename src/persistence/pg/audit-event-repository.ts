/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: src/contracts/tenancy/entities.ts (AuditEvent), src/contracts/
 *   tenancy/audit.ts (recordAuditEvent / event hashing), migrations/0001_tenancy_foundation.sql
 *   (audit_event table).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 checkpoint B2.
 *   Append-only audit trail. eventHash is computed by the domain layer (audit.ts) and stored
 *   verbatim; this repository only persists and reads — it never mutates history.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { AuditEvent } from "../../contracts/tenancy/entities.js";
import type { Queryable } from "../database-port.js";

export interface AppendAuditEventInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly actorOrganizationId: string;
  readonly clientOrganizationId?: string | null;
  readonly projectId?: string | null;
  readonly action: string;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly eventHash: string;
}

interface AuditEventRow {
  id: string;
  organization_id: string;
  actor_user_id: string;
  actor_organization_id: string;
  client_organization_id: string | null;
  project_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  event_hash: string;
  created_at: Date;
}

function mapRow(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actorUserId: row.actor_user_id,
    actorOrganizationId: row.actor_organization_id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    eventHash: row.event_hash,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgAuditEventRepository {
  constructor(private readonly db: Queryable) {}

  async append(input: AppendAuditEventInput): Promise<AuditEvent> {
    const res = await this.db.query<AuditEventRow>(
      `INSERT INTO audit_event
         (organization_id, actor_user_id, actor_organization_id, client_organization_id,
          project_id, action, target_type, target_id, metadata, event_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING *`,
      [
        input.organizationId,
        input.actorUserId,
        input.actorOrganizationId,
        input.clientOrganizationId ?? null,
        input.projectId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.metadata === undefined || input.metadata === null
          ? null
          : JSON.stringify(input.metadata),
        input.eventHash,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("audit_event insert returned no row");
    return mapRow(row);
  }

  async listByOrganization(organizationId: string, limit = 100): Promise<AuditEvent[]> {
    const res = await this.db.query<AuditEventRow>(
      `SELECT * FROM audit_event WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [organizationId, limit],
    );
    return res.rows.map(mapRow);
  }

  async listByProject(projectId: string, limit = 100): Promise<AuditEvent[]> {
    const res = await this.db.query<AuditEventRow>(
      `SELECT * FROM audit_event WHERE project_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [projectId, limit],
    );
    return res.rows.map(mapRow);
  }
}
