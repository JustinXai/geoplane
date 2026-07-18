/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ../entities.ts (KnowledgeDocument), ../ports.ts
 *   (KnowledgeDocumentRepository), migrations/0002_knowledge_runtime.sql (knowledge_document).
 * reconstruction_reason: KNOWLEDGE_SCHEMA_AND_PORTS_V1 - real Postgres persistence for a
 *   knowledge document. Version content is managed by PgKnowledgeVersionRepository.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { Queryable } from "../../../persistence/database-port.js";
import type { KnowledgeDocument } from "../entities.js";
import type {
  CreateKnowledgeDocumentInput,
  KnowledgeDocumentRepository,
} from "../ports.js";

interface KnowledgeDocumentRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  package_id: string;
  title: string;
  source_kind: KnowledgeDocument["sourceKind"];
  current_version_number: number;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    packageId: row.package_id,
    title: row.title,
    sourceKind: row.source_kind,
    currentVersionNumber: row.current_version_number,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgKnowledgeDocumentRepository implements KnowledgeDocumentRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateKnowledgeDocumentInput): Promise<KnowledgeDocument> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `INSERT INTO knowledge_document
         (client_organization_id, project_id, package_id, title, source_kind, created_by_user_id)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'FILE'), $6)
       RETURNING *`,
      [
        input.clientOrganizationId,
        input.projectId,
        input.packageId,
        input.title,
        input.sourceKind ?? null,
        input.createdByUserId,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("knowledge_document insert returned no row");
    return mapRow(row);
  }

  async findById(id: string): Promise<KnowledgeDocument | null> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      "SELECT * FROM knowledge_document WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async listByPackage(packageId: string): Promise<KnowledgeDocument[]> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT * FROM knowledge_document WHERE package_id = $1
       ORDER BY created_at, id`,
      [packageId],
    );
    return res.rows.map(mapRow);
  }
}
