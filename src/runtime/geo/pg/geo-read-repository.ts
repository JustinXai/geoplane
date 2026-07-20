/**
 * GEO_READ_API_V1 (Agent E4) — read-only, tenant-scoped Postgres queries that
 * back the GEO read-side App Router routes.
 *
 * This adapter is DELIBERATELY read-only and DELIBERATELY separate from the E1
 * consumer-defined ports (src/runtime/geo/ports.ts): those ports are append-only
 * write/read surfaces owned by the E1-E3 services, and this checkpoint does not
 * touch them. The read routes need two projections the write ports do not
 * expose:
 *
 *   1. opportunity_validation BY SCOPE — the E1 OpportunityValidationRepository
 *      port only offers add/getById; the read side needs every validation for a
 *      (client, project) scope to derive an opportunity's client-facing status
 *      and to compute the "awaiting review" queue.
 *   2. a delivery-centre projection — the terminal article state joined across
 *      article_draft -> (gates / approval / publish -> cnc -> plan -> receipt ->
 *      delivery), which no single write repository exposes.
 *
 * Every query is scoped by client_organization_id + project_id, mirroring the
 * tenant scoping the write adapters already enforce. Nothing here mutates.
 */
import type { OpportunityValidationStatus } from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { TenantScope } from "../ports.js";

/** One opportunity_validation row, reduced to the fields the read side needs. */
export interface OpportunityValidationReadRow {
  /**
   * The validation's own id. NOT for client-facing views — the read mappers use it only to build
   * the OPAQUE, HMAC-signed reviewReferenceCode (review-reference.ts); the raw UUID never reaches a
   * client-facing body.
   */
  readonly validationId: string;
  readonly opportunityId: string;
  readonly status: OpportunityValidationStatus;
  readonly validatedAt: string;
}

/**
 * The delivery-centre read model for one article (the latest draft version of a
 * brief). Booleans/timestamps are raw facts; the client-facing status is derived
 * from them in views.ts (DELIVERED > APPROVED > IN_REVIEW > IN_PRODUCTION).
 */
export interface DeliveryArticleReadModel {
  readonly articleDraftId: string;
  readonly projectId: string;
  readonly title: string;
  readonly approved: boolean;
  readonly inReview: boolean;
  readonly deliveredAt: string | null;
  readonly publicationRegisteredAt: string | null;
}

interface ValidationRow {
  id: string;
  opportunity_id: string;
  status: OpportunityValidationStatus;
  validated_at: Date;
}

interface DraftRow {
  id: string;
  project_id: string;
  title: string;
}

interface DraftIdRow {
  article_draft_id: string;
}

interface DeliveryJoinRow {
  article_draft_id: string;
  delivered_at: Date;
  published_at: Date;
}

/**
 * A publication receipt with its associated delivery details for read views.
 */
export interface DeliveryReceiptReadModel {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly distributionPlanId: string;
  readonly channelId: string;
  readonly publishedByActorId: string;
  readonly publishedAt: string;
  readonly deliveredAt: string;
}

export class GeoReadRepository {
  constructor(private readonly db: Queryable) {}

  /** Every opportunity_validation for a scope, oldest first. */
  async listOpportunityValidationsByScope(
    scope: TenantScope,
  ): Promise<OpportunityValidationReadRow[]> {
    const res = await this.db.query<ValidationRow>(
      `SELECT id, opportunity_id, status, validated_at
         FROM opportunity_validation
        WHERE client_organization_id = $1 AND project_id = $2
        ORDER BY validated_at, id`,
      [scope.clientOrganizationId, scope.projectId],
    );
    return res.rows.map((row) => ({
      validationId: row.id,
      opportunityId: row.opportunity_id,
      status: row.status,
      validatedAt: row.validated_at.toISOString(),
    }));
  }

  /**
   * The delivery-centre projection for a scope: one row per article (the latest
   * draft version of each brief), with the facts needed to derive its status.
   */
  async listDeliveryArticlesByScope(
    scope: TenantScope,
  ): Promise<DeliveryArticleReadModel[]> {
    const params: readonly [string, string] = [
      scope.clientOrganizationId,
      scope.projectId,
    ];

    // Spine: the latest draft version of each brief in this scope.
    const draftRes = await this.db.query<DraftRow>(
      `SELECT DISTINCT ON (article_brief_id) id, project_id, title
         FROM article_draft
        WHERE client_organization_id = $1 AND project_id = $2
        ORDER BY article_brief_id, version DESC, id`,
      params,
    );

    // Draft ids that reached a final human approval.
    const approvedRes = await this.db.query<DraftIdRow>(
      `SELECT DISTINCT article_draft_id
         FROM article_approval
        WHERE client_organization_id = $1 AND project_id = $2`,
      params,
    );
    const approvedDraftIds = new Set(approvedRes.rows.map((r) => r.article_draft_id));

    // Draft ids that have at least one gate outcome recorded (in review).
    const gatedRes = await this.db.query<DraftIdRow>(
      `SELECT article_draft_id FROM quality_gate_result
        WHERE client_organization_id = $1 AND project_id = $2
        UNION
       SELECT article_draft_id FROM platform_gate_result
        WHERE client_organization_id = $1 AND project_id = $2
        UNION
       SELECT article_draft_id FROM vertical_gate_result
        WHERE client_organization_id = $1 AND project_id = $2`,
      params,
    );
    const gatedDraftIds = new Set(gatedRes.rows.map((r) => r.article_draft_id));

    // Delivered articles: delivery -> receipt -> plan -> cnc -> publish_package
    // -> the article_draft the package was built from.
    const deliveredRes = await this.db.query<DeliveryJoinRow>(
      `SELECT pp.article_draft_id AS article_draft_id,
              d.delivered_at      AS delivered_at,
              pr.published_at     AS published_at
         FROM delivery d
         JOIN publication_receipt pr ON pr.id = d.publication_receipt_id
         JOIN distribution_plan dp ON dp.id = d.distribution_plan_id
         JOIN channel_neutral_content_package cnc
           ON cnc.id = dp.channel_neutral_content_package_id
         JOIN publish_package pp ON pp.id = cnc.publish_package_id
        WHERE d.client_organization_id = $1 AND d.project_id = $2
        ORDER BY d.delivered_at`,
      params,
    );

    // Keep the most recent delivery per draft (later rows overwrite earlier).
    const deliveredByDraft = new Map<string, { deliveredAt: string; publishedAt: string }>();
    for (const row of deliveredRes.rows) {
      deliveredByDraft.set(row.article_draft_id, {
        deliveredAt: row.delivered_at.toISOString(),
        publishedAt: row.published_at.toISOString(),
      });
    }

    return draftRes.rows.map((draft) => {
      const delivered = deliveredByDraft.get(draft.id);
      return {
        articleDraftId: draft.id,
        projectId: draft.project_id,
        title: draft.title,
        approved: approvedDraftIds.has(draft.id),
        inReview: gatedDraftIds.has(draft.id),
        deliveredAt: delivered ? delivered.deliveredAt : null,
        publicationRegisteredAt: delivered ? delivered.publishedAt : null,
      };
    });
  }

  /**
   * Lists all delivery receipts for a scope, including delivery details.
   * Returns receipts ordered by publication date (newest first).
   */
  async listDeliveryReceiptsByScope(
    scope: TenantScope,
  ): Promise<DeliveryReceiptReadModel[]> {
    const res = await this.db.query<{
      id: string;
      client_organization_id: string;
      project_id: string;
      distribution_plan_id: string;
      channel_id: string;
      published_by_actor_id: string;
      published_at: Date;
      delivered_at: Date;
    }>(
      `SELECT pr.id, pr.client_organization_id, pr.project_id, pr.distribution_plan_id,
              pr.channel_id, pr.published_by_actor_id, pr.published_at, d.delivered_at
         FROM publication_receipt pr
         JOIN delivery d ON d.publication_receipt_id = pr.id
        WHERE pr.client_organization_id = $1 AND pr.project_id = $2
        ORDER BY pr.published_at DESC, pr.id DESC`,
      [scope.clientOrganizationId, scope.projectId],
    );

    return res.rows.map((row) => ({
      id: row.id,
      clientOrganizationId: row.client_organization_id,
      projectId: row.project_id,
      distributionPlanId: row.distribution_plan_id,
      channelId: row.channel_id,
      publishedByActorId: row.published_by_actor_id,
      publishedAt: row.published_at.toISOString(),
      deliveredAt: row.delivered_at.toISOString(),
    }));
  }
}
