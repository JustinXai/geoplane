/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * ArticleBriefRepository port, backed by the article_brief table of
 * 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY: `add` inserts a brand-new brief and rejects a duplicate id (the
 * primary key raises 23505, translated to the same append-only rejection the
 * in-memory fake produces). No update/overwrite. The ArticleBriefPlanningContextV1
 * is stored inline; its non-empty tuples (targetKeywords,
 * authorizingHumanReviewDecisionIds) round-trip through array columns whose CHECKs
 * mirror the frozen non-empty contract.
 */
import type {
  ArticleBrief,
  ArticleBriefPlanningContextV1,
} from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { ArticleBriefRepository } from "../ports.js";
import { isUniqueViolation, ParamList } from "./pg-support.js";

interface BriefRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  opportunity_family_id: string;
  working_title: string;
  outline: string[];
  planning_schema_version: "ArticleBriefPlanningContextV1";
  planning_opportunity_family_id: string;
  planning_risk_level: ArticleBriefPlanningContextV1["riskLevel"];
  planning_target_keywords: string[];
  planning_authorizing_hrd_ids: string[];
  created_at: Date;
}

function mapRow(row: BriefRow): ArticleBrief {
  const targetKeywords = row.planning_target_keywords;
  const firstKeyword = targetKeywords[0];
  const hrdIds = row.planning_authorizing_hrd_ids;
  const firstHrd = hrdIds[0];
  if (!firstKeyword || !firstHrd) {
    throw new Error(
      `article_brief ${row.id} is missing required non-empty planning-context lists`,
    );
  }

  const planningContext: ArticleBriefPlanningContextV1 = {
    schemaVersion: "ArticleBriefPlanningContextV1",
    opportunityFamilyId: row.planning_opportunity_family_id,
    authorizingHumanReviewDecisionIds: [firstHrd, ...hrdIds.slice(1)],
    targetKeywords: [firstKeyword, ...targetKeywords.slice(1)],
    riskLevel: row.planning_risk_level,
  };

  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    opportunityFamilyId: row.opportunity_family_id,
    planningContext,
    workingTitle: row.working_title,
    outline: row.outline,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgArticleBriefRepository implements ArticleBriefRepository {
  constructor(private readonly db: Queryable) {}

  async add(brief: ArticleBrief): Promise<ArticleBrief> {
    const p = new ParamList();
    const text = `INSERT INTO article_brief
        (id, client_organization_id, project_id, opportunity_family_id, working_title, outline,
         planning_schema_version, planning_opportunity_family_id, planning_risk_level,
         planning_target_keywords, planning_authorizing_hrd_ids, created_at)
      VALUES (${p.add(brief.id)}, ${p.add(brief.clientOrganizationId)}, ${p.add(brief.projectId)},
              ${p.add(brief.opportunityFamilyId)}, ${p.add(brief.workingTitle)},
              ${p.array(brief.outline, "text[]")},
              ${p.add(brief.planningContext.schemaVersion)},
              ${p.add(brief.planningContext.opportunityFamilyId)},
              ${p.add(brief.planningContext.riskLevel)},
              ${p.array(brief.planningContext.targetKeywords, "text[]")},
              ${p.array(brief.planningContext.authorizingHumanReviewDecisionIds, "uuid[]")},
              ${p.add(brief.createdAt)})
      RETURNING *`;

    let res;
    try {
      res = await this.db.query<BriefRow>(text, p.values);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgArticleBriefRepository: refusing to overwrite existing id "${brief.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("article_brief insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<ArticleBrief | undefined> {
    const res = await this.db.query<BriefRow>(
      "SELECT * FROM article_brief WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }
}
