/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ../entities.ts (KnowledgeIssue), ../ports.ts
 *   (KnowledgeIssueRepository), migrations/0002_knowledge_runtime.sql (knowledge_issue).
 * reconstruction_reason: KNOWLEDGE_SCHEMA_AND_PORTS_V1 - real Postgres persistence for the
 *   quality findings (knowledge gaps, unverified facts, forbidden usage, classification
 *   prompts) that gate package confirmation.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { Queryable } from "../../../persistence/database-port.js";
import type { KnowledgeIssue } from "../entities.js";
import type {
  CreateKnowledgeIssueInput,
  KnowledgeIssueRepository,
} from "../ports.js";

interface KnowledgeIssueRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  package_id: string;
  document_id: string | null;
  kind: KnowledgeIssue["kind"];
  severity: KnowledgeIssue["severity"];
  message: string;
  resolved: boolean;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  created_by_user_id: string;
  created_at: Date;
}

function mapRow(row: KnowledgeIssueRow): KnowledgeIssue {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    packageId: row.package_id,
    documentId: row.document_id,
    kind: row.kind,
    severity: row.severity,
    message: row.message,
    resolved: row.resolved,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    resolvedByUserId: row.resolved_by_user_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgKnowledgeIssueRepository implements KnowledgeIssueRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateKnowledgeIssueInput): Promise<KnowledgeIssue> {
    const res = await this.db.query<KnowledgeIssueRow>(
      `INSERT INTO knowledge_issue
         (client_organization_id, project_id, package_id, document_id, kind, severity,
          message, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'WARNING'), $7, $8)
       RETURNING *`,
      [
        input.clientOrganizationId,
        input.projectId,
        input.packageId,
        input.documentId ?? null,
        input.kind,
        input.severity ?? null,
        input.message,
        input.createdByUserId,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("knowledge_issue insert returned no row");
    return mapRow(row);
  }

  async listByPackage(
    packageId: string,
    openOnly = false,
  ): Promise<KnowledgeIssue[]> {
    const res = await this.db.query<KnowledgeIssueRow>(
      `SELECT * FROM knowledge_issue
       WHERE package_id = $1 AND ($2::boolean = false OR resolved = false)
       ORDER BY created_at, id`,
      [packageId, openOnly],
    );
    return res.rows.map(mapRow);
  }

  async resolve(id: string, resolvedByUserId: string): Promise<KnowledgeIssue> {
    const res = await this.db.query<KnowledgeIssueRow>(
      `UPDATE knowledge_issue
         SET resolved = true, resolved_at = now(), resolved_by_user_id = $2
       WHERE id = $1 AND resolved = false
       RETURNING *`,
      [id, resolvedByUserId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error(`knowledge_issue ${id} not found or already resolved`);
    }
    return mapRow(row);
  }

  async countOpen(packageId: string): Promise<number> {
    const res = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM knowledge_issue
       WHERE package_id = $1 AND resolved = false`,
      [packageId],
    );
    return Number(res.rows[0]?.n ?? "0");
  }
}
