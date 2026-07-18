/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: src/contracts/tenancy/entities.ts (Organization), migrations/
 *   0001_tenancy_foundation.sql (organization table + uq_organization_idempotency_key).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 - real persistence
 *   for Organization with database-enforced create-idempotency. Ten concurrent creates with
 *   the same idempotency key must yield exactly ONE organization row (SYSTEM_INVARIANTS_V1:
 *   "display names must not be used as a unique key" - idempotency_key is the real key).
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type {
  Organization,
  OrganizationStatus,
  OrganizationType,
} from "../../contracts/tenancy/entities.js";
import type { Queryable } from "../database-port.js";

export interface CreateOrganizationInput {
  readonly type: OrganizationType;
  readonly displayName: string;
  readonly idempotencyKey: string;
  readonly createdByUserId: string;
  readonly status?: OrganizationStatus;
  readonly sourceNamespace?: string | null;
  readonly externalReference?: string | null;
}

interface OrganizationRow {
  id: string;
  type: OrganizationType;
  display_name: string;
  status: OrganizationStatus;
  idempotency_key: string;
  source_namespace: string | null;
  external_reference: string | null;
  created_at: Date;
  created_by_user_id: string;
}

function mapRow(row: OrganizationRow): Organization {
  return {
    id: row.id,
    type: row.type,
    displayName: row.display_name,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    sourceNamespace: row.source_namespace,
    externalReference: row.external_reference,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
  };
}

export class PgOrganizationRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Idempotent create keyed on idempotency_key. The INSERT ... ON CONFLICT DO NOTHING
   * provides the concurrency serialization: exactly one racer inserts; every other racer
   * blocks on the unique index, then finds the committed row via the UNION-ALL fallback.
   * The result is always the single canonical row for that key.
   */
  async createIdempotent(input: CreateOrganizationInput): Promise<Organization> {
    const sql = `
      WITH inserted AS (
        INSERT INTO organization
          (type, display_name, status, idempotency_key, source_namespace, external_reference, created_by_user_id)
        VALUES ($1, $2, COALESCE($3, 'ACTIVE'), $4, $5, $6, $7)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT * FROM organization
        WHERE idempotency_key = $4 AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1;`;
    const res = await this.db.query<OrganizationRow>(sql, [
      input.type,
      input.displayName,
      input.status ?? null,
      input.idempotencyKey,
      input.sourceNamespace ?? null,
      input.externalReference ?? null,
      input.createdByUserId,
    ]);
    const row = res.rows[0];
    if (!row) {
      throw new Error(
        `createIdempotent returned no row for idempotencyKey=${input.idempotencyKey}`,
      );
    }
    return mapRow(row);
  }

  async findById(id: string): Promise<Organization | null> {
    const res = await this.db.query<OrganizationRow>(
      "SELECT * FROM organization WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async countByIdempotencyKey(idempotencyKey: string): Promise<number> {
    const res = await this.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM organization WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    return Number(res.rows[0]?.n ?? "0");
  }
}
