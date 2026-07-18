/**
 * KEYWORD_OPPORTUNITY_RUNTIME_V1 — Postgres adapter for the E1
 * OpportunityValidationRepository port, backed by the append-only
 * opportunity_validation table of migrations/0003_geo_runtime.sql.
 *
 * APPEND-ONLY, at two layers: this adapter exposes only `add`/`getById` (no
 * update), and the table itself forbids UPDATE/DELETE via trigger. A duplicate
 * id raises 23505, translated to the same append-only rejection the in-memory
 * fake produces.
 */
import type {
  GeoValidationGateLevel,
  OpportunityValidation,
  OpportunityValidationStatus,
} from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { OpportunityValidationRepository } from "../ports.js";

interface ValidationRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  opportunity_id: string;
  status: OpportunityValidationStatus;
  industry_profile_id: string;
  gate_level_applied: GeoValidationGateLevel;
  reason_note: string;
  validated_at: Date;
}

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

function mapRow(row: ValidationRow): OpportunityValidation {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    opportunityId: row.opportunity_id,
    status: row.status,
    industryProfileId: row.industry_profile_id,
    gateLevelApplied: row.gate_level_applied,
    reasonNote: row.reason_note,
    validatedAt: row.validated_at.toISOString(),
  };
}

export class PgOpportunityValidationRepository implements OpportunityValidationRepository {
  constructor(private readonly db: Queryable) {}

  async add(validation: OpportunityValidation): Promise<OpportunityValidation> {
    let res;
    try {
      res = await this.db.query<ValidationRow>(
        `INSERT INTO opportunity_validation
           (id, client_organization_id, project_id, opportunity_id, status,
            industry_profile_id, gate_level_applied, reason_note, validated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          validation.id,
          validation.clientOrganizationId,
          validation.projectId,
          validation.opportunityId,
          validation.status,
          validation.industryProfileId,
          validation.gateLevelApplied,
          validation.reasonNote,
          validation.validatedAt,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgOpportunityValidationRepository: refusing to overwrite existing id "${validation.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("opportunity_validation insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<OpportunityValidation | undefined> {
    const res = await this.db.query<ValidationRow>(
      "SELECT * FROM opportunity_validation WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }
}
