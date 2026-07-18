/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * DeliveryRepository port, the append-only home of PublicationReceipts (the
 * terminal artifact of the chain), backed by the publication_receipt + delivery
 * tables of 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY at two layers: `add`/`listByPlan`/`listByScope` only, and both
 * tables forbid UPDATE/DELETE via trigger.
 *
 * NO AUTOMATIC PUBLICATION: `add` writes the receipt as given; its
 * published_by_actor_id is re-checked at the DB level by
 * ck_publication_receipt_no_auto_publish, which rejects a blank or
 * automatic/system actor id ('system'/'auto'/'automated'/'automatic') — the same
 * set the frozen createPublicationReceipt enforces. A forged receipt with a
 * system actor is rejected by the database even if it bypasses the typed
 * constructor.
 *
 * Each receipt is written atomically with its client-readable `delivery`
 * projection row inside ONE transaction, so a delivery can never exist without
 * the receipt that authorized it, and a receipt is always paired with the
 * client-readable delivery record.
 */
import type { PublicationReceipt } from "../../../contracts/geo-business/entities.js";
import type { DatabasePort } from "../../../persistence/database-port.js";
import type { DeliveryRepository, TenantScope } from "../ports.js";
import { isUniqueViolation } from "./pg-support.js";

interface ReceiptRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  distribution_plan_id: string;
  channel_id: string;
  published_by_actor_id: string;
  published_at: Date;
}

function mapRow(row: ReceiptRow): PublicationReceipt {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    distributionPlanId: row.distribution_plan_id,
    channelId: row.channel_id,
    publishedByActorId: row.published_by_actor_id,
    publishedAt: row.published_at.toISOString(),
  };
}

export class PgDeliveryRepository implements DeliveryRepository {
  constructor(private readonly db: DatabasePort) {}

  async add(receipt: PublicationReceipt): Promise<PublicationReceipt> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO publication_receipt
             (id, client_organization_id, project_id, distribution_plan_id, channel_id,
              published_by_actor_id, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            receipt.id,
            receipt.clientOrganizationId,
            receipt.projectId,
            receipt.distributionPlanId,
            receipt.channelId,
            receipt.publishedByActorId,
            receipt.publishedAt,
          ],
        );
        // Client-readable delivery projection, paired 1:1 with the receipt.
        await tx.query(
          `INSERT INTO delivery
             (client_organization_id, project_id, distribution_plan_id, publication_receipt_id,
              channel_id, delivered_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            receipt.clientOrganizationId,
            receipt.projectId,
            receipt.distributionPlanId,
            receipt.id,
            receipt.channelId,
            receipt.publishedAt,
          ],
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgDeliveryRepository: refusing to overwrite existing id "${receipt.id}" (append-only).`,
        );
      }
      throw err;
    }

    return receipt;
  }

  async listByPlan(distributionPlanId: string): Promise<PublicationReceipt[]> {
    const res = await this.db.query<ReceiptRow>(
      `SELECT * FROM publication_receipt WHERE distribution_plan_id = $1 ORDER BY published_at, id`,
      [distributionPlanId],
    );
    return res.rows.map(mapRow);
  }

  async listByScope(scope: TenantScope): Promise<PublicationReceipt[]> {
    const res = await this.db.query<ReceiptRow>(
      `SELECT * FROM publication_receipt
       WHERE client_organization_id = $1 AND project_id = $2
       ORDER BY published_at, id`,
      [scope.clientOrganizationId, scope.projectId],
    );
    return res.rows.map(mapRow);
  }
}
