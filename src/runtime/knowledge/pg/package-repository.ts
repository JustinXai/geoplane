/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ../entities.ts (KnowledgePackage), ../ports.ts
 *   (KnowledgePackageRepository), migrations/0002_knowledge_runtime.sql (knowledge_package).
 * reconstruction_reason: KNOWLEDGE_SCHEMA_AND_PORTS_V1 - real Postgres persistence for the
 *   knowledge package aggregate root. Mirrors the src/persistence/pg/* repository style
 *   (constructor takes a Queryable; snake_case rows mapped to camelCase entities; ISO dates).
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { Queryable } from "../../../persistence/database-port.js";
import type {
  KnowledgePackage,
  KnowledgePackageStatus,
  KnowledgePackageWithCounts,
} from "../entities.js";
import type {
  CreateKnowledgePackageInput,
  KnowledgePackageRepository,
} from "../ports.js";

interface KnowledgePackageRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  title: string;
  status: KnowledgePackageStatus;
  classification: KnowledgePackage["classification"];
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
  confirmed_at: Date | null;
  confirmed_by_user_id: string | null;
}

function mapRow(row: KnowledgePackageRow): KnowledgePackage {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    classification: row.classification,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    confirmedByUserId: row.confirmed_by_user_id,
  };
}

export class PgKnowledgePackageRepository implements KnowledgePackageRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateKnowledgePackageInput): Promise<KnowledgePackage> {
    const res = await this.db.query<KnowledgePackageRow>(
      `INSERT INTO knowledge_package
         (client_organization_id, project_id, title, status, classification, created_by_user_id)
       VALUES ($1, $2, $3, COALESCE($4, 'DRAFT'), COALESCE($5, 'INTERNAL'), $6)
       RETURNING *`,
      [
        input.clientOrganizationId,
        input.projectId,
        input.title,
        input.status ?? null,
        input.classification ?? null,
        input.createdByUserId,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("knowledge_package insert returned no row");
    return mapRow(row);
  }

  async findById(id: string): Promise<KnowledgePackage | null> {
    const res = await this.db.query<KnowledgePackageRow>(
      "SELECT * FROM knowledge_package WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async listByProject(
    projectId: string,
    clientOrganizationId: string,
  ): Promise<KnowledgePackage[]> {
    const res = await this.db.query<KnowledgePackageRow>(
      `SELECT * FROM knowledge_package
       WHERE project_id = $1 AND client_organization_id = $2
       ORDER BY created_at DESC, id`,
      [projectId, clientOrganizationId],
    );
    return res.rows.map(mapRow);
  }

  async getWithCounts(
    id: string,
    clientOrganizationId: string,
  ): Promise<KnowledgePackageWithCounts | null> {
    const res = await this.db.query<
      KnowledgePackageRow & { document_count: string; open_issue_count: string }
    >(
      `SELECT p.*,
              (SELECT count(*) FROM knowledge_document d WHERE d.package_id = p.id) AS document_count,
              (SELECT count(*) FROM knowledge_issue i
                 WHERE i.package_id = p.id AND i.resolved = false) AS open_issue_count
       FROM knowledge_package p
       WHERE p.id = $1 AND p.client_organization_id = $2`,
      [id, clientOrganizationId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      ...mapRow(row),
      documentCount: Number(row.document_count),
      openIssueCount: Number(row.open_issue_count),
    };
  }

  async setStatus(
    id: string,
    status: KnowledgePackageStatus,
  ): Promise<KnowledgePackage> {
    if (status === "CONFIRMED") {
      throw new Error("Use confirm() to move a package to CONFIRMED");
    }
    const res = await this.db.query<KnowledgePackageRow>(
      `UPDATE knowledge_package
         SET status = $2, updated_at = now(),
             confirmed_at = NULL, confirmed_by_user_id = NULL
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`knowledge_package ${id} not found`);
    return mapRow(row);
  }

  async confirm(id: string, confirmedByUserId: string): Promise<KnowledgePackage> {
    const res = await this.db.query<KnowledgePackageRow>(
      `UPDATE knowledge_package
         SET status = 'CONFIRMED', confirmed_at = now(),
             confirmed_by_user_id = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, confirmedByUserId],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`knowledge_package ${id} not found`);
    return mapRow(row);
  }
}
