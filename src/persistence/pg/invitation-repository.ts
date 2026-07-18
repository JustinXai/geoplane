/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: src/contracts/tenancy/entities.ts (Invitation), migrations/
 *   0001_tenancy_foundation.sql (invitation table + uq_invitation_token_hash).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 checkpoint B2.
 *   Stores only the token HASH, never the raw token (SECURITY_IMPORT_REPORT.md).
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type {
  Invitation,
  InvitationStatus,
  PlatformRole,
} from "../../contracts/tenancy/entities.js";
import type { Queryable } from "../database-port.js";

export interface CreateInvitationInput {
  readonly organizationId: string;
  readonly invitedEmail: string;
  readonly role: PlatformRole;
  readonly tokenHash: string;
  readonly createdByUserId: string;
  readonly expiresAt: string | Date;
}

interface InvitationRow {
  id: string;
  organization_id: string;
  invited_email: string;
  role: PlatformRole;
  status: InvitationStatus;
  token_hash: string;
  created_by_user_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
}

function mapRow(row: InvitationRow): Invitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    invitedEmail: row.invited_email,
    role: row.role,
    status: row.status,
    tokenHash: row.token_hash,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    revokedByUserId: row.revoked_by_user_id,
  };
}

export class PgInvitationRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateInvitationInput): Promise<Invitation> {
    const expiresAt =
      input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt;
    const res = await this.db.query<InvitationRow>(
      `INSERT INTO invitation
         (organization_id, invited_email, role, status, token_hash, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6)
       RETURNING *`,
      [input.organizationId, input.invitedEmail, input.role, input.tokenHash, input.createdByUserId, expiresAt],
    );
    const row = res.rows[0];
    if (!row) throw new Error("invitation insert returned no row");
    return mapRow(row);
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const res = await this.db.query<InvitationRow>(
      "SELECT * FROM invitation WHERE token_hash = $1",
      [tokenHash],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  /** Marks a PENDING invitation ACCEPTED. Returns the updated row, or null if it was not PENDING. */
  async markAccepted(id: string): Promise<Invitation | null> {
    const res = await this.db.query<InvitationRow>(
      `UPDATE invitation SET status = 'ACCEPTED'
       WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async revoke(id: string, revokedByUserId: string): Promise<void> {
    await this.db.query(
      `UPDATE invitation
       SET status = 'REVOKED', revoked_at = now(), revoked_by_user_id = $2
       WHERE id = $1 AND status = 'PENDING'`,
      [id, revokedByUserId],
    );
  }
}
