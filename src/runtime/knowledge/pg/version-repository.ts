/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ../entities.ts (KnowledgeVersion), ../ports.ts
 *   (KnowledgeVersionRepository), migrations/0002_knowledge_runtime.sql (knowledge_version,
 *   uq_knowledge_version_document_version, trg_knowledge_version_forbid_update).
 * reconstruction_reason: KNOWLEDGE_SCHEMA_AND_PORTS_V1 - real Postgres persistence for the
 *   append-only version stream of a document. addVersion appends the next version_number and
 *   bumps the document's current_version_number in a single atomic statement (data-modifying
 *   CTE), so the two never drift.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { Queryable } from "../../../persistence/database-port.js";
import type { KnowledgeVersion } from "../entities.js";
import type {
  AddKnowledgeVersionInput,
  KnowledgeVersionRepository,
} from "../ports.js";

interface KnowledgeVersionRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  package_id: string;
  document_id: string;
  version_number: number;
  storage_path: string | null;
  content_hash: string;
  // BIGINT is returned by node-postgres as a string.
  byte_size: string | null;
  mime_type: string | null;
  created_by_user_id: string;
  created_at: Date;
}

function mapRow(row: KnowledgeVersionRow): KnowledgeVersion {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    packageId: row.package_id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    storagePath: row.storage_path,
    contentHash: row.content_hash,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    mimeType: row.mime_type,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgKnowledgeVersionRepository implements KnowledgeVersionRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Atomic append: compute the next version_number for the document, insert the
   * new version row (inheriting the document's tenant/project/package scope), and
   * bump knowledge_document.current_version_number - all in one statement so a
   * concurrent racer either serializes on the unique index or sees a consistent
   * counter. Returns the newly inserted version.
   */
  async addVersion(input: AddKnowledgeVersionInput): Promise<KnowledgeVersion> {
    const res = await this.db.query<KnowledgeVersionRow>(
      `WITH nextv AS (
         SELECT COALESCE(MAX(version_number), 0) + 1 AS n
         FROM knowledge_version WHERE document_id = $1
       ),
       doc AS (
         SELECT client_organization_id, project_id, package_id
         FROM knowledge_document WHERE id = $1
       ),
       ins AS (
         INSERT INTO knowledge_version
           (client_organization_id, project_id, package_id, document_id, version_number,
            storage_path, content_hash, byte_size, mime_type, created_by_user_id)
         SELECT doc.client_organization_id, doc.project_id, doc.package_id, $1, nextv.n,
                $2, $3, $4, $5, $6
         FROM doc, nextv
         RETURNING *
       ),
       upd AS (
         UPDATE knowledge_document
           SET current_version_number = (SELECT n FROM nextv), updated_at = now()
           WHERE id = $1 AND EXISTS (SELECT 1 FROM ins)
       )
       SELECT * FROM ins`,
      [
        input.documentId,
        input.storagePath ?? null,
        input.contentHash,
        input.byteSize ?? null,
        input.mimeType ?? null,
        input.createdByUserId,
      ],
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error(
        `addVersion: knowledge_document ${input.documentId} not found`,
      );
    }
    return mapRow(row);
  }

  async listByDocument(documentId: string): Promise<KnowledgeVersion[]> {
    const res = await this.db.query<KnowledgeVersionRow>(
      `SELECT * FROM knowledge_version WHERE document_id = $1
       ORDER BY version_number`,
      [documentId],
    );
    return res.rows.map(mapRow);
  }

  async getLatest(documentId: string): Promise<KnowledgeVersion | null> {
    const res = await this.db.query<KnowledgeVersionRow>(
      `SELECT * FROM knowledge_version WHERE document_id = $1
       ORDER BY version_number DESC LIMIT 1`,
      [documentId],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }
}
