/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ../entities.ts (KnowledgeSnapshot), ../ports.ts
 *   (KnowledgeSnapshotRepository), migrations/0002_knowledge_runtime.sql (knowledge_snapshot,
 *   uq_knowledge_snapshot_one_current_per_package).
 * reconstruction_reason: KNOWLEDGE_SCHEMA_AND_PORTS_V1 - real Postgres persistence for the
 *   sealed, channel-neutral snapshot of a confirmed package.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * create() runs inside a transaction (constructor takes the DatabasePort) so the two
 * mutations - superseding the prior current snapshot, then inserting the new current one -
 * are ordered and atomic. A single data-modifying CTE is deliberately NOT used here: the
 * partial unique index "one current snapshot per package" is checked per-row immediately,
 * and CTE sub-statement ordering is unspecified, which could transiently show two current
 * rows. Sequential statements in one transaction guarantee the supersede lands first.
 */
import type { DatabasePort } from "../../../persistence/database-port.js";
import type { KnowledgeSnapshot } from "../entities.js";
import type {
  CreateKnowledgeSnapshotInput,
  KnowledgeSnapshotRepository,
} from "../ports.js";

interface KnowledgeSnapshotRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  package_id: string;
  snapshot_number: number;
  content_hash: string;
  document_count: number;
  classification: KnowledgeSnapshot["classification"];
  superseded_at: Date | null;
  created_by_user_id: string;
  created_at: Date;
}

function mapRow(row: KnowledgeSnapshotRow): KnowledgeSnapshot {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    packageId: row.package_id,
    snapshotNumber: row.snapshot_number,
    contentHash: row.content_hash,
    documentCount: row.document_count,
    classification: row.classification,
    supersededAt: row.superseded_at ? row.superseded_at.toISOString() : null,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgKnowledgeSnapshotRepository implements KnowledgeSnapshotRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: CreateKnowledgeSnapshotInput): Promise<KnowledgeSnapshot> {
    return this.db.transaction(async (tx) => {
      // 1. Supersede whatever is currently the active snapshot for this package.
      await tx.query(
        `UPDATE knowledge_snapshot
           SET superseded_at = now()
         WHERE package_id = $1 AND superseded_at IS NULL`,
        [input.packageId],
      );

      // 2. Insert the new current snapshot with the next sequence number.
      const res = await tx.query<KnowledgeSnapshotRow>(
        `INSERT INTO knowledge_snapshot
           (client_organization_id, project_id, package_id, snapshot_number,
            content_hash, document_count, classification, created_by_user_id)
         VALUES (
           $1, $2, $3,
           (SELECT COALESCE(MAX(snapshot_number), 0) + 1
              FROM knowledge_snapshot WHERE package_id = $3),
           $4, $5, COALESCE($6, 'INTERNAL'), $7
         )
         RETURNING *`,
        [
          input.clientOrganizationId,
          input.projectId,
          input.packageId,
          input.contentHash,
          input.documentCount,
          input.classification ?? null,
          input.createdByUserId,
        ],
      );
      const row = res.rows[0];
      if (!row) throw new Error("knowledge_snapshot insert returned no row");
      return mapRow(row);
    });
  }

  async getCurrent(packageId: string): Promise<KnowledgeSnapshot | null> {
    const res = await this.db.query<KnowledgeSnapshotRow>(
      `SELECT * FROM knowledge_snapshot
       WHERE package_id = $1 AND superseded_at IS NULL`,
      [packageId],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async listByPackage(packageId: string): Promise<KnowledgeSnapshot[]> {
    const res = await this.db.query<KnowledgeSnapshotRow>(
      `SELECT * FROM knowledge_snapshot WHERE package_id = $1
       ORDER BY snapshot_number`,
      [packageId],
    );
    return res.rows.map(mapRow);
  }
}
