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
import type { Queryable, SqlParam } from "../../../persistence/database-port.js";
import type { TenantScope } from "../ports.js";

/** Cast a string array to readonly SqlParam[] (pg supports array binding via ANY()). */
function asArrayParam(arr: readonly string[]): readonly SqlParam[] {
  return arr as unknown as readonly SqlParam[];
}

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

// ---------------------------------------------------------------------------
// Article Brief / Draft read models
// ---------------------------------------------------------------------------

/** Article brief with its latest draft's id/version/status (for brief listing). */
export interface ArticleBriefWithDraftReadModel {
  readonly briefId: string;
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly workingTitle: string;
  readonly riskLevel: string;
  readonly outline: readonly string[];
  readonly createdAt: string;
  readonly latestDraftId: string | null;
  readonly latestDraftVersion: number | null;
  readonly latestDraftStatus: string | null;
  readonly latestDraftCompiledAt: string | null;
  readonly hasGateResults: boolean;
  readonly hasApproval: boolean;
}

/** Full detail of one article draft for the draft detail page. */
export interface ArticleDraftDetailReadModel {
  readonly draftId: string;
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly articleBriefId: string;
  readonly briefWorkingTitle: string;
  readonly briefOutline: readonly string[];
  readonly briefRiskLevel: string;
  readonly title: string;
  readonly version: number;
  readonly status: string;
  readonly sections: readonly { heading: string; order: number }[];
  readonly compiledAt: string;
  readonly hasGateResults: boolean;
  readonly qualityGateStatus: string | null;
  readonly qualityGateReasons: readonly string[];
  readonly qualityGateEvaluatedAt: string | null;
  readonly platformGateStatus: string | null;
  readonly platformGateReasons: readonly string[];
  readonly platformGateEvaluatedAt: string | null;
  readonly verticalGateStatus: string | null;
  readonly verticalGateReasons: readonly string[];
  readonly verticalGateEvaluatedAt: string | null;
  readonly approvalId: string | null;
  readonly approvalApprovedAt: string | null;
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

  // ---------------------------------------------------------------------------
  // Article Brief listing (for Brief page)
  // ---------------------------------------------------------------------------

  async listArticleBriefsWithDraftAndGateStatus(
    scope: TenantScope,
  ): Promise<ArticleBriefWithDraftReadModel[]> {
    const params: readonly [string, string] = [
      scope.clientOrganizationId,
      scope.projectId,
    ];

    const briefs = await this.db.query<{
      brief_id: string;
      project_id: string;
      client_organization_id: string;
      working_title: string;
      risk_level: string;
      outline: string[];
      created_at: Date;
    }>(
      `SELECT id AS brief_id, project_id, client_organization_id,
              working_title, planning_risk_level AS risk_level,
              outline, created_at
         FROM article_brief
        WHERE client_organization_id = $1 AND project_id = $2
        ORDER BY created_at DESC`,
      params,
    );

    if (briefs.rows.length === 0) return [];

    const briefIds = briefs.rows.map((r) => r.brief_id);

    // Latest draft per brief: DISTINCT ON keeps the first row per brief_id after ORDER BY version DESC.
    const drafts = await this.db.query<{
      article_brief_id: string;
      id: string;
      version: number;
      status: string;
      compiled_at: Date;
    }>(
      `SELECT DISTINCT ON (article_brief_id)
              article_brief_id, id, version, status, compiled_at
         FROM article_draft
        WHERE article_brief_id = ANY($1)
        ORDER BY article_brief_id, version DESC`,
      asArrayParam(briefIds),
    );

    const draftByBrief = new Map(drafts.rows.map((r) => [r.article_brief_id, r]));

    // Gate results exist for these draft ids.
    const gated = await this.db.query<{ article_draft_id: string }>(
      `SELECT article_draft_id FROM quality_gate_result
         WHERE article_draft_id = ANY($1)
        UNION
       SELECT article_draft_id FROM platform_gate_result
         WHERE article_draft_id = ANY($1)
        UNION
       SELECT article_draft_id FROM vertical_gate_result
         WHERE article_draft_id = ANY($1)`,
      asArrayParam(drafts.rows.map((r) => r.id)),
    );
    const gatedSet = new Set(gated.rows.map((r) => r.article_draft_id));

    // Approved draft ids.
    const approved = await this.db.query<{ article_draft_id: string }>(
      `SELECT article_draft_id FROM article_approval WHERE article_draft_id = ANY($1)`,
      asArrayParam(drafts.rows.map((r) => r.id)),
    );
    const approvedSet = new Set(approved.rows.map((r) => r.article_draft_id));

    return briefs.rows.map((b) => {
      const d = draftByBrief.get(b.brief_id);
      return {
        briefId: b.brief_id,
        projectId: b.project_id,
        clientOrganizationId: b.client_organization_id,
        workingTitle: b.working_title,
        riskLevel: b.risk_level,
        outline: b.outline,
        createdAt: b.created_at.toISOString(),
        latestDraftId: d?.id ?? null,
        latestDraftVersion: d?.version ?? null,
        latestDraftStatus: d?.status ?? null,
        latestDraftCompiledAt: d ? new Date(d.compiled_at).toISOString() : null,
        hasGateResults: d ? gatedSet.has(d.id) : false,
        hasApproval: d ? approvedSet.has(d.id) : false,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Article Draft detail (for Draft detail page)
  // ---------------------------------------------------------------------------

  async getArticleDraftDetail(params: {
    articleDraftId: string;
    clientOrganizationId: string;
    projectId: string;
  }): Promise<ArticleDraftDetailReadModel | null> {
    const draftRow = await this.db.query<{
      id: string;
      article_brief_id: string;
      title: string;
      version: number;
      status: string;
      section_headings: string[];
      compiled_at: Date;
    }>(
      `SELECT id, article_brief_id, title, version, status, section_headings, compiled_at
         FROM article_draft
        WHERE id = $1 AND client_organization_id = $2 AND project_id = $3`,
      [params.articleDraftId, params.clientOrganizationId, params.projectId],
    );
    const d = draftRow.rows[0];
    if (!d) return null;

    const briefRow = await this.db.query<{
      working_title: string;
      outline: string[];
      planning_risk_level: string;
    }>(
      `SELECT working_title, outline, planning_risk_level
         FROM article_brief WHERE id = $1`,
      [d.article_brief_id],
    );
    const b = briefRow.rows[0];

    const qGate = await this.db.query<{
      status: string;
      failure_reasons: string[];
      evaluated_at: Date;
    }>(
      `SELECT status, failure_reasons, evaluated_at
         FROM quality_gate_result
        WHERE article_draft_id = $1
        ORDER BY evaluated_at DESC LIMIT 1`,
      [d.id],
    );
    const pGate = await this.db.query<{
      status: string;
      failure_reasons: string[];
      evaluated_at: Date;
    }>(
      `SELECT status, failure_reasons, evaluated_at
         FROM platform_gate_result
        WHERE article_draft_id = $1
        ORDER BY evaluated_at DESC LIMIT 1`,
      [d.id],
    );
    const vGate = await this.db.query<{
      status: string;
      failure_reasons: string[];
      evaluated_at: Date;
    }>(
      `SELECT status, failure_reasons, evaluated_at
         FROM vertical_gate_result
        WHERE article_draft_id = $1
        ORDER BY evaluated_at DESC LIMIT 1`,
      [d.id],
    );
    const approval = await this.db.query<{
      id: string;
      approved_at: Date;
    }>(
      `SELECT id, approved_at FROM article_approval
         WHERE article_draft_id = $1 ORDER BY approved_at DESC LIMIT 1`,
      [d.id],
    );

    return {
      draftId: d.id,
      projectId: params.projectId,
      clientOrganizationId: params.clientOrganizationId,
      articleBriefId: d.article_brief_id,
      briefWorkingTitle: b?.working_title ?? "",
      briefOutline: b?.outline ?? [],
      briefRiskLevel: b?.planning_risk_level ?? "STANDARD",
      title: d.title,
      version: d.version,
      status: d.status,
      sections: (d.section_headings ?? []).map((heading: string, i: number) => ({ heading, order: i })),
      compiledAt: new Date(d.compiled_at).toISOString(),
      hasGateResults: qGate.rows.length > 0 || pGate.rows.length > 0 || vGate.rows.length > 0,
      qualityGateStatus: qGate.rows[0]?.status ?? null,
      qualityGateReasons: qGate.rows[0]?.failure_reasons ?? [],
      qualityGateEvaluatedAt: qGate.rows[0] ? new Date(qGate.rows[0].evaluated_at).toISOString() : null,
      platformGateStatus: pGate.rows[0]?.status ?? null,
      platformGateReasons: pGate.rows[0]?.failure_reasons ?? [],
      platformGateEvaluatedAt: pGate.rows[0] ? new Date(pGate.rows[0].evaluated_at).toISOString() : null,
      verticalGateStatus: vGate.rows[0]?.status ?? null,
      verticalGateReasons: vGate.rows[0]?.failure_reasons ?? [],
      verticalGateEvaluatedAt: vGate.rows[0] ? new Date(vGate.rows[0].evaluated_at).toISOString() : null,
      approvalId: approval.rows[0]?.id ?? null,
      approvalApprovedAt: approval.rows[0] ? new Date(approval.rows[0].approved_at).toISOString() : null,
    };
  }
}
