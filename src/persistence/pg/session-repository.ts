/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: src/contracts/tenancy/entities.ts (Session), migrations/
 *   0001_tenancy_foundation.sql (session table).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 checkpoint B2.
 *   Server-side session store. sessionVersion is snapshotted at issue time so a stale
 *   session can be detected when the underlying authorization facts change.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { PlatformRole, Session } from "../../contracts/tenancy/entities.js";
import type { Queryable } from "../database-port.js";

export interface CreateSessionInput {
  readonly userId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly role: PlatformRole;
  readonly activeClientOrganizationId?: string | null;
  readonly activeProjectId?: string | null;
  readonly sessionVersion: number;
  readonly expiresAt: string | Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  membership_id: string;
  organization_id: string;
  role: PlatformRole;
  active_client_organization_id: string | null;
  active_project_id: string | null;
  session_version: number;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function mapRow(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    membershipId: row.membership_id,
    organizationId: row.organization_id,
    role: row.role,
    activeClientOrganizationId: row.active_client_organization_id,
    activeProjectId: row.active_project_id,
    sessionVersion: row.session_version,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

export class PgSessionRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateSessionInput): Promise<Session> {
    const expiresAt =
      input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt;
    const res = await this.db.query<SessionRow>(
      `INSERT INTO session
         (user_id, membership_id, organization_id, role,
          active_client_organization_id, active_project_id, session_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.userId,
        input.membershipId,
        input.organizationId,
        input.role,
        input.activeClientOrganizationId ?? null,
        input.activeProjectId ?? null,
        input.sessionVersion,
        expiresAt,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("session insert returned no row");
    return mapRow(row);
  }

  async findById(id: string): Promise<Session | null> {
    const res = await this.db.query<SessionRow>("SELECT * FROM session WHERE id = $1", [id]);
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async revoke(id: string): Promise<void> {
    await this.db.query(
      "UPDATE session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
      [id],
    );
  }

  async listActiveByUser(userId: string): Promise<Session[]> {
    const res = await this.db.query<SessionRow>(
      `SELECT * FROM session
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
      [userId],
    );
    return res.rows.map(mapRow);
  }
}
