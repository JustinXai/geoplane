/**
 * RUNTIME_DATA_CONTINUITY_V1 (Agent B) — real Postgres adapter for the geo
 * `IndustryProfileRepository` port (src/runtime/geo/ports.ts), backed by the
 * `industry_profile` table added in migrations/0005_runtime_continuity.sql.
 *
 * Replaces the composition root's append-only in-memory
 * `MemIndustryProfileRepository`. Maps the 0005 row to the geo-business
 * `IndustryProfile` contract (src/contracts/geo-business/entities.ts) with no
 * value translation (enum literals mirror the contract).
 *
 * `add` is insert-only and matches the in-memory fake's contract: a duplicate
 * primary key is rejected as append-only. On top of that, the table's
 * one-canonical-per-project UNIQUE(client_organization_id, project_id) rejects a
 * second (different-id) profile for a project.
 *
 * `upsert` is the canonical re-classification path (beyond the minimal consumer
 * port): it updates the single per-project profile in place, bumping updated_at
 * and keeping the existing canonical id.
 */
import type { IndustryProfile } from "../../contracts/geo-business/entities.js";
import type { GeoValidationGateLevel } from "../../contracts/geo-business/entities.js";
import type { Queryable, SqlParam } from "../database-port.js";
import type { IndustryProfileRepository } from "../../runtime/geo/ports.js";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

function violatedConstraint(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "constraint" in err) {
    const c = (err as { constraint?: unknown }).constraint;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

interface IndustryProfileRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  vertical_slug: string;
  vertical_label: string;
  validation_gate_level: GeoValidationGateLevel;
  rule_set_version: number;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: IndustryProfileRow): IndustryProfile {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    verticalSlug: row.vertical_slug,
    verticalLabel: row.vertical_label,
    validationGateLevel: row.validation_gate_level,
    ruleSetVersion: row.rule_set_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function insertValues(profile: IndustryProfile): SqlParam[] {
  return [
    profile.id,
    profile.clientOrganizationId,
    profile.projectId,
    profile.verticalSlug,
    profile.verticalLabel,
    profile.validationGateLevel,
    profile.ruleSetVersion,
    profile.createdAt,
    profile.updatedAt,
  ];
}

const INSERT_COLUMNS = `(id, client_organization_id, project_id, vertical_slug, vertical_label,
   validation_gate_level, rule_set_version, created_at, updated_at)`;
const INSERT_PLACEHOLDERS = `($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

export class PgIndustryProfileRepository implements IndustryProfileRepository {
  constructor(private readonly db: Queryable) {}

  async add(profile: IndustryProfile): Promise<IndustryProfile> {
    try {
      const res = await this.db.query<IndustryProfileRow>(
        `INSERT INTO industry_profile ${INSERT_COLUMNS}
         VALUES ${INSERT_PLACEHOLDERS}
         RETURNING *`,
        insertValues(profile),
      );
      const row = res.rows[0];
      if (!row) throw new Error("industry_profile insert returned no row");
      return mapRow(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        if (violatedConstraint(err) === "uq_industry_profile_per_project") {
          throw new Error(
            `PgIndustryProfileRepository.add: one canonical IndustryProfile per project — a profile ` +
              `already exists for project "${profile.projectId}" (use upsert to re-classify).`,
          );
        }
        throw new Error(
          `PgIndustryProfileRepository.add: refusing to overwrite existing id "${profile.id}" (append-only).`,
        );
      }
      throw err;
    }
  }

  /**
   * Re-classify the single canonical IndustryProfile for a project in place.
   * INSERTs a new profile, or — when one already exists for
   * (client_organization_id, project_id) — updates that canonical row's
   * classification fields and bumps updated_at, preserving the existing id and
   * created_at. Returns the canonical row.
   */
  async upsert(profile: IndustryProfile): Promise<IndustryProfile> {
    const res = await this.db.query<IndustryProfileRow>(
      `INSERT INTO industry_profile ${INSERT_COLUMNS}
       VALUES ${INSERT_PLACEHOLDERS}
       ON CONFLICT (client_organization_id, project_id) DO UPDATE SET
         vertical_slug = EXCLUDED.vertical_slug,
         vertical_label = EXCLUDED.vertical_label,
         validation_gate_level = EXCLUDED.validation_gate_level,
         rule_set_version = EXCLUDED.rule_set_version,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      insertValues(profile),
    );
    const row = res.rows[0];
    if (!row) throw new Error("industry_profile upsert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<IndustryProfile | undefined> {
    const res = await this.db.query<IndustryProfileRow>(
      "SELECT * FROM industry_profile WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }
}
