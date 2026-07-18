/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: src/contracts/tenancy/entities.ts (Membership), migrations/
 *   0001_tenancy_foundation.sql (membership table, trg_membership_sync_organization_type,
 *   uq_membership_one_active_client_org_per_user).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 - real persistence
 *   for Membership. The "a CLIENT user may belong to at most one ACTIVE CLIENT organization"
 *   invariant is enforced by the DATABASE (partial unique index), not this code: a second
 *   active client membership raises unique_violation (23505). organization_type is a
 *   trigger-maintained mirror, so this repository deliberately never writes it.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type {
  Membership,
  MembershipStatus,
  PlatformRole,
} from "../../contracts/tenancy/entities.js";
import type { Queryable } from "../database-port.js";

/** Postgres SQLSTATE for unique_violation - the DB's way of rejecting a second active client org. */
export const PG_UNIQUE_VIOLATION = "23505";

export interface CreateMembershipInput {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: PlatformRole;
  readonly status?: MembershipStatus;
}

interface MembershipRow {
  id: string;
  user_id: string;
  organization_id: string;
  role: PlatformRole;
  status: MembershipStatus;
  created_at: Date;
}

function mapRow(row: MembershipRow): Membership {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgMembershipRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Inserts a membership. organization_type is intentionally omitted from the column list:
   * the BEFORE INSERT trigger recomputes it from organization.type (source of truth), so any
   * value passed here would be ignored. A duplicate active CLIENT membership for the same
   * user throws with code PG_UNIQUE_VIOLATION.
   */
  async create(input: CreateMembershipInput): Promise<Membership> {
    const res = await this.db.query<MembershipRow>(
      `INSERT INTO membership (user_id, organization_id, role, status)
       VALUES ($1, $2, $3, COALESCE($4, 'ACTIVE'))
       RETURNING id, user_id, organization_id, role, status, created_at`,
      [input.userId, input.organizationId, input.role, input.status ?? null],
    );
    const row = res.rows[0];
    if (!row) throw new Error("membership insert returned no row");
    return mapRow(row);
  }

  async listActiveByUser(userId: string): Promise<Membership[]> {
    const res = await this.db.query<MembershipRow>(
      `SELECT id, user_id, organization_id, role, status, created_at
       FROM membership WHERE user_id = $1 AND status = 'ACTIVE'
       ORDER BY created_at`,
      [userId],
    );
    return res.rows.map(mapRow);
  }
}
