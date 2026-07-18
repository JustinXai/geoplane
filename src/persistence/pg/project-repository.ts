/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: src/contracts/tenancy/entities.ts (Project), migrations/
 *   0001_tenancy_foundation.sql (project table).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 checkpoint B2.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { Project } from "../../contracts/tenancy/entities.js";
import type { Queryable } from "../database-port.js";

export interface CreateProjectInput {
  readonly clientOrganizationId: string;
  readonly name: string;
  readonly createdByUserId: string;
}

interface ProjectRow {
  id: string;
  client_organization_id: string;
  name: string;
  created_at: Date;
  created_by_user_id: string;
}

function mapRow(row: ProjectRow): Project {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
  };
}

export class PgProjectRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const res = await this.db.query<ProjectRow>(
      `INSERT INTO project (client_organization_id, name, created_by_user_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [input.clientOrganizationId, input.name, input.createdByUserId],
    );
    const row = res.rows[0];
    if (!row) throw new Error("project insert returned no row");
    return mapRow(row);
  }

  async findById(id: string): Promise<Project | null> {
    const res = await this.db.query<ProjectRow>("SELECT * FROM project WHERE id = $1", [id]);
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async listForClient(clientOrganizationId: string): Promise<Project[]> {
    const res = await this.db.query<ProjectRow>(
      `SELECT * FROM project WHERE client_organization_id = $1 ORDER BY created_at`,
      [clientOrganizationId],
    );
    return res.rows.map(mapRow);
  }
}
