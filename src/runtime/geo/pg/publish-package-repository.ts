/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * PublishPackageRepository port, backed by the publish_package table of
 * 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY: `add`/`getById`/`listByScope` only; a duplicate id raises 23505,
 * translated to the same append-only rejection the fake produces. article_
 * approval_id is a NOT-NULL FK to article_approval — nothing may be packaged for
 * publication without a real approval.
 */
import type { PublishPackage } from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { PublishPackageRepository, TenantScope } from "../ports.js";
import { isUniqueViolation } from "./pg-support.js";

interface PublishPackageRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  article_approval_id: string;
  article_draft_id: string;
  title: string;
  built_at: Date;
}

function mapRow(row: PublishPackageRow): PublishPackage {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    articleApprovalId: row.article_approval_id,
    articleDraftId: row.article_draft_id,
    title: row.title,
    builtAt: row.built_at.toISOString(),
  };
}

export class PgPublishPackageRepository implements PublishPackageRepository {
  constructor(private readonly db: Queryable) {}

  async add(pkg: PublishPackage): Promise<PublishPackage> {
    let res;
    try {
      res = await this.db.query<PublishPackageRow>(
        `INSERT INTO publish_package
           (id, client_organization_id, project_id, article_approval_id, article_draft_id, title, built_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          pkg.id,
          pkg.clientOrganizationId,
          pkg.projectId,
          pkg.articleApprovalId,
          pkg.articleDraftId,
          pkg.title,
          pkg.builtAt,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgPublishPackageRepository: refusing to overwrite existing id "${pkg.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("publish_package insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<PublishPackage | undefined> {
    const res = await this.db.query<PublishPackageRow>(
      "SELECT * FROM publish_package WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async listByScope(scope: TenantScope): Promise<PublishPackage[]> {
    const res = await this.db.query<PublishPackageRow>(
      `SELECT * FROM publish_package
       WHERE client_organization_id = $1 AND project_id = $2
       ORDER BY built_at, id`,
      [scope.clientOrganizationId, scope.projectId],
    );
    return res.rows.map(mapRow);
  }
}
