/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * ArticleApprovalRepository port, backed by the append-only article_approval
 * table of 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY at two layers: `add`/`getById` only, and the table forbids
 * UPDATE/DELETE via trigger.
 *
 * NO SILENT APPROVAL: there is no code path here through which an approval can
 * be persisted without a real approver. `add` takes a full ArticleApproval whose
 * approverId + approvedAt are non-optional; those are written to NOT-NULL columns
 * (approver_user_id is additionally a real FK to "user") and re-asserted by the
 * table's ck_article_approval_no_silent_approve CHECK. The three gate-status
 * columns are pinned to 'PASSED', so an approval built on a failed/missing gate
 * cannot be stored. There is no "approve with default approver" convenience.
 */
import type { ArticleApproval } from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { ArticleApprovalRepository } from "../ports.js";
import { isUniqueViolation } from "./pg-support.js";

interface ApprovalRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  article_draft_id: string;
  approver_user_id: string;
  approved_at: Date;
  quality_gate_id: string;
  platform_gate_id: string;
  vertical_gate_id: string;
}

function mapRow(row: ApprovalRow): ArticleApproval {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    articleDraftId: row.article_draft_id,
    approverId: row.approver_user_id,
    approvedAt: row.approved_at.toISOString(),
    qualityGateId: row.quality_gate_id,
    qualityGateStatus: "PASSED",
    platformGateId: row.platform_gate_id,
    platformGateStatus: "PASSED",
    verticalGateId: row.vertical_gate_id,
    verticalGateStatus: "PASSED",
  };
}

export class PgArticleApprovalRepository implements ArticleApprovalRepository {
  constructor(private readonly db: Queryable) {}

  async add(approval: ArticleApproval): Promise<ArticleApproval> {
    let res;
    try {
      res = await this.db.query<ApprovalRow>(
        `INSERT INTO article_approval
           (id, client_organization_id, project_id, article_draft_id, approver_user_id, approved_at,
            quality_gate_id, quality_gate_status, platform_gate_id, platform_gate_status,
            vertical_gate_id, vertical_gate_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          approval.id,
          approval.clientOrganizationId,
          approval.projectId,
          approval.articleDraftId,
          approval.approverId,
          approval.approvedAt,
          approval.qualityGateId,
          approval.qualityGateStatus,
          approval.platformGateId,
          approval.platformGateStatus,
          approval.verticalGateId,
          approval.verticalGateStatus,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgArticleApprovalRepository: refusing to overwrite existing id "${approval.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("article_approval insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<ArticleApproval | undefined> {
    const res = await this.db.query<ApprovalRow>(
      "SELECT * FROM article_approval WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }
}
