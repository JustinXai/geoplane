/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ../entities.ts (EnterpriseProfile), ../ports.ts
 *   (EnterpriseProfileRepository), migrations/0002_knowledge_runtime.sql (enterprise_profile,
 *   uq_enterprise_profile_client_org).
 * reconstruction_reason: KNOWLEDGE_SCHEMA_AND_PORTS_V1 - real Postgres persistence for the
 *   single enterprise identity profile per client organization. upsert() is idempotent on
 *   the client-org unique key: first call inserts, subsequent calls update in place.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { Queryable } from "../../../persistence/database-port.js";
import type { EnterpriseProfile } from "../entities.js";
import type {
  EnterpriseProfileRepository,
  UpsertEnterpriseProfileInput,
} from "../ports.js";

interface EnterpriseProfileRow {
  id: string;
  client_organization_id: string;
  legal_name: string;
  display_name: string | null;
  primary_domain: string | null;
  industry: string | null;
  description: string | null;
  default_classification: EnterpriseProfile["defaultClassification"];
  forbidden_usage: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_by_user_id: string;
  updated_at: Date;
}

function mapRow(row: EnterpriseProfileRow): EnterpriseProfile {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    legalName: row.legal_name,
    displayName: row.display_name,
    primaryDomain: row.primary_domain,
    industry: row.industry,
    description: row.description,
    defaultClassification: row.default_classification,
    forbiddenUsage: row.forbidden_usage,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedByUserId: row.updated_by_user_id,
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgEnterpriseProfileRepository implements EnterpriseProfileRepository {
  constructor(private readonly db: Queryable) {}

  async upsert(input: UpsertEnterpriseProfileInput): Promise<EnterpriseProfile> {
    const res = await this.db.query<EnterpriseProfileRow>(
      `INSERT INTO enterprise_profile
         (client_organization_id, legal_name, display_name, primary_domain, industry,
          description, default_classification, forbidden_usage,
          created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'INTERNAL'), $8, $9, $9)
       ON CONFLICT (client_organization_id) DO UPDATE SET
         legal_name = EXCLUDED.legal_name,
         display_name = EXCLUDED.display_name,
         primary_domain = EXCLUDED.primary_domain,
         industry = EXCLUDED.industry,
         description = EXCLUDED.description,
         default_classification = EXCLUDED.default_classification,
         forbidden_usage = EXCLUDED.forbidden_usage,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = now()
       RETURNING *`,
      [
        input.clientOrganizationId,
        input.legalName,
        input.displayName ?? null,
        input.primaryDomain ?? null,
        input.industry ?? null,
        input.description ?? null,
        input.defaultClassification ?? null,
        input.forbiddenUsage ?? null,
        input.actingUserId,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("enterprise_profile upsert returned no row");
    return mapRow(row);
  }

  async findByClientOrganization(
    clientOrganizationId: string,
  ): Promise<EnterpriseProfile | null> {
    const res = await this.db.query<EnterpriseProfileRow>(
      "SELECT * FROM enterprise_profile WHERE client_organization_id = $1",
      [clientOrganizationId],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }
}
