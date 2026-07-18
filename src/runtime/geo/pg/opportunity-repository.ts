/**
 * KEYWORD_OPPORTUNITY_RUNTIME_V1 — Postgres adapter for the E1
 * OpportunityRepository port, backed by the opportunity table of
 * migrations/0003_geo_runtime.sql.
 *
 * APPEND-ONLY, consistent with the in-memory fake: `add` inserts a new record
 * and rejects a duplicate id (the primary key raises 23505, translated to the
 * same append-only rejection the fake produces). No update/overwrite.
 */
import type { Opportunity } from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { OpportunityRepository, TenantScope } from "../ports.js";

interface OpportunityRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  keyword_question_map_id: string;
  keyword: string;
  grounding_knowledge_package_id: string;
  grounding_knowledge_package_version: number;
  created_at: Date;
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

function mapRow(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    keywordQuestionMapId: row.keyword_question_map_id,
    keyword: row.keyword,
    groundingKnowledgePackageId: row.grounding_knowledge_package_id,
    groundingKnowledgePackageVersion: row.grounding_knowledge_package_version,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgOpportunityRepository implements OpportunityRepository {
  constructor(private readonly db: Queryable) {}

  async add(opportunity: Opportunity): Promise<Opportunity> {
    let res;
    try {
      res = await this.db.query<OpportunityRow>(
        `INSERT INTO opportunity
           (id, client_organization_id, project_id, keyword_question_map_id, keyword,
            grounding_knowledge_package_id, grounding_knowledge_package_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          opportunity.id,
          opportunity.clientOrganizationId,
          opportunity.projectId,
          opportunity.keywordQuestionMapId,
          opportunity.keyword,
          opportunity.groundingKnowledgePackageId,
          opportunity.groundingKnowledgePackageVersion,
          opportunity.createdAt,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgOpportunityRepository: refusing to overwrite existing id "${opportunity.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("opportunity insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<Opportunity | undefined> {
    const res = await this.db.query<OpportunityRow>(
      "SELECT * FROM opportunity WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async listByScope(scope: TenantScope): Promise<Opportunity[]> {
    const res = await this.db.query<OpportunityRow>(
      `SELECT * FROM opportunity
       WHERE client_organization_id = $1 AND project_id = $2
       ORDER BY created_at, id`,
      [scope.clientOrganizationId, scope.projectId],
    );
    return res.rows.map(mapRow);
  }
}
