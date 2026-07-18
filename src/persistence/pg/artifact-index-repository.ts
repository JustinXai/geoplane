/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: src/contracts/tenancy/entities.ts (ArtifactIndex), migrations/
 *   0001_tenancy_foundation.sql (artifact_index table + trg_artifact_index_forbid_update/
 *   _delete append-only triggers).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 - real persistence
 *   for the append-only ArtifactIndex. This repository exposes ONLY append + read: there is
 *   deliberately no update() or delete(), and the database itself rejects UPDATE/DELETE via
 *   trigger, so sealed history cannot be rewritten even by a compromised app credential.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { ArtifactIndex } from "../../contracts/tenancy/entities.js";
import type { Queryable } from "../database-port.js";

export interface AppendArtifactIndexInput {
  readonly artifactType: string;
  readonly artifactId: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly artifactVersion: number;
  readonly storagePath: string;
  readonly sealedAt: string | Date;
  readonly contentHash: string;
}

interface ArtifactIndexRow {
  id: string;
  artifact_type: string;
  artifact_id: string;
  client_organization_id: string;
  project_id: string;
  artifact_version: number;
  storage_path: string;
  sealed_at: Date;
  created_at: Date;
  content_hash: string;
}

function mapRow(row: ArtifactIndexRow): ArtifactIndex {
  return {
    id: row.id,
    artifactType: row.artifact_type,
    artifactId: row.artifact_id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    artifactVersion: row.artifact_version,
    storagePath: row.storage_path,
    sealedAt: row.sealed_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    contentHash: row.content_hash,
  };
}

export class PgArtifactIndexRepository {
  constructor(private readonly db: Queryable) {}

  async append(input: AppendArtifactIndexInput): Promise<ArtifactIndex> {
    const sealedAt =
      input.sealedAt instanceof Date ? input.sealedAt.toISOString() : input.sealedAt;
    const res = await this.db.query<ArtifactIndexRow>(
      `INSERT INTO artifact_index
         (artifact_type, artifact_id, client_organization_id, project_id,
          artifact_version, storage_path, sealed_at, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.artifactType,
        input.artifactId,
        input.clientOrganizationId,
        input.projectId,
        input.artifactVersion,
        input.storagePath,
        sealedAt,
        input.contentHash,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("artifact_index insert returned no row");
    return mapRow(row);
  }

  async listByProject(projectId: string): Promise<ArtifactIndex[]> {
    const res = await this.db.query<ArtifactIndexRow>(
      `SELECT * FROM artifact_index WHERE project_id = $1
       ORDER BY artifact_type, artifact_id, artifact_version`,
      [projectId],
    );
    return res.rows.map(mapRow);
  }
}
