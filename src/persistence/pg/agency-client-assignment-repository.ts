/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: src/contracts/tenancy/entities.ts (AgencyClientAssignment),
 *   migrations/0001_tenancy_foundation.sql (agency_client_assignment +
 *   uq_agency_client_assignment_active_pair partial unique on ACTIVE).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 checkpoint B2.
 *   Existence of an ACTIVE row is the ONLY thing that authorizes an agency over a client —
 *   no wildcard/implicit access. isAuthorized() is the persistence-layer half of the
 *   "Agency reads an unauthorized client -> reject" invariant.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type {
  AgencyClientAssignment,
  AgencyClientAssignmentStatus,
} from "../../contracts/tenancy/entities.js";
import type { Queryable } from "../database-port.js";

export const PG_UNIQUE_VIOLATION = "23505";

export interface AssignClientInput {
  readonly agencyOrganizationId: string;
  readonly clientOrganizationId: string;
  readonly assignedByUserId: string;
}

interface AssignmentRow {
  id: string;
  agency_organization_id: string;
  client_organization_id: string;
  status: AgencyClientAssignmentStatus;
  assigned_by_user_id: string;
  assigned_at: Date;
  revoked_at: Date | null;
}

function mapRow(row: AssignmentRow): AgencyClientAssignment {
  return {
    id: row.id,
    agencyOrganizationId: row.agency_organization_id,
    clientOrganizationId: row.client_organization_id,
    status: row.status,
    assignedByUserId: row.assigned_by_user_id,
    assignedAt: row.assigned_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

export class PgAgencyClientAssignmentRepository {
  constructor(private readonly db: Queryable) {}

  /** Creates an ACTIVE assignment. A second ACTIVE row for the same (agency, client) throws 23505. */
  async assign(input: AssignClientInput): Promise<AgencyClientAssignment> {
    const res = await this.db.query<AssignmentRow>(
      `INSERT INTO agency_client_assignment
         (agency_organization_id, client_organization_id, status, assigned_by_user_id, assigned_at)
       VALUES ($1, $2, 'ACTIVE', $3, now())
       RETURNING *`,
      [input.agencyOrganizationId, input.clientOrganizationId, input.assignedByUserId],
    );
    const row = res.rows[0];
    if (!row) throw new Error("agency_client_assignment insert returned no row");
    return mapRow(row);
  }

  async revoke(agencyOrganizationId: string, clientOrganizationId: string): Promise<void> {
    await this.db.query(
      `UPDATE agency_client_assignment
       SET status = 'REVOKED', revoked_at = now()
       WHERE agency_organization_id = $1 AND client_organization_id = $2 AND status = 'ACTIVE'`,
      [agencyOrganizationId, clientOrganizationId],
    );
  }

  /** The authorization check: is there an ACTIVE assignment row for this pair? */
  async isAuthorized(agencyOrganizationId: string, clientOrganizationId: string): Promise<boolean> {
    const res = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM agency_client_assignment
         WHERE agency_organization_id = $1 AND client_organization_id = $2 AND status = 'ACTIVE'
       ) AS exists`,
      [agencyOrganizationId, clientOrganizationId],
    );
    return res.rows[0]?.exists === true;
  }

  async listActiveClientIds(agencyOrganizationId: string): Promise<string[]> {
    const res = await this.db.query<{ client_organization_id: string }>(
      `SELECT client_organization_id FROM agency_client_assignment
       WHERE agency_organization_id = $1 AND status = 'ACTIVE'
       ORDER BY assigned_at`,
      [agencyOrganizationId],
    );
    return res.rows.map((r) => r.client_organization_id);
  }
}
