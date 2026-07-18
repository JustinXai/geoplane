/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * DistributionPlanRepository port, backed by the distribution_plan table of
 * 0004_geo_article_delivery.sql. This table holds the auditable channel set.
 *
 * APPEND-ONLY: `add`/`getById`/`getByChannelNeutralContentPackage` only; a
 * duplicate id raises 23505, translated to the same append-only rejection the
 * fake produces. channel_ids is CHECK'd non-empty and selected_by_actor_id +
 * selected_at are NOT NULL, so a plan can never represent "ready to distribute"
 * without recording which human explicitly chose the channels and when — there
 * is no automatic default channel.
 */
import type { DistributionPlan } from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { DistributionPlanRepository } from "../ports.js";
import { isUniqueViolation, ParamList } from "./pg-support.js";

interface PlanRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  channel_neutral_content_package_id: string;
  channel_ids: string[];
  selected_by_actor_id: string;
  selected_at: Date;
}

function mapRow(row: PlanRow): DistributionPlan {
  const channelIds = row.channel_ids;
  const first = channelIds[0];
  if (!first) {
    throw new Error(
      `distribution_plan ${row.id} has no channel_ids (contract requires at least one)`,
    );
  }
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    channelNeutralContentPackageId: row.channel_neutral_content_package_id,
    channelIds: [first, ...channelIds.slice(1)],
    selectedByActorId: row.selected_by_actor_id,
    selectedAt: row.selected_at.toISOString(),
  };
}

export class PgDistributionPlanRepository implements DistributionPlanRepository {
  constructor(private readonly db: Queryable) {}

  async add(plan: DistributionPlan): Promise<DistributionPlan> {
    const p = new ParamList();
    const text = `INSERT INTO distribution_plan
        (id, client_organization_id, project_id, channel_neutral_content_package_id,
         channel_ids, selected_by_actor_id, selected_at)
      VALUES (${p.add(plan.id)}, ${p.add(plan.clientOrganizationId)}, ${p.add(plan.projectId)},
              ${p.add(plan.channelNeutralContentPackageId)}, ${p.array(plan.channelIds, "text[]")},
              ${p.add(plan.selectedByActorId)}, ${p.add(plan.selectedAt)})
      RETURNING *`;

    let res;
    try {
      res = await this.db.query<PlanRow>(text, p.values);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgDistributionPlanRepository: refusing to overwrite existing id "${plan.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("distribution_plan insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<DistributionPlan | undefined> {
    const res = await this.db.query<PlanRow>(
      "SELECT * FROM distribution_plan WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async getByChannelNeutralContentPackage(
    channelNeutralContentPackageId: string,
  ): Promise<DistributionPlan | undefined> {
    const res = await this.db.query<PlanRow>(
      `SELECT * FROM distribution_plan
       WHERE channel_neutral_content_package_id = $1
       ORDER BY selected_at, id
       LIMIT 1`,
      [channelNeutralContentPackageId],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }
}
