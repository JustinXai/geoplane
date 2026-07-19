import type { Queryable } from "../../persistence/database-port.js";
import type { OptionalDemandEvidenceSeed, OptionalKeywordSeed } from "./contracts.js";
import type { OptionalKeywordEnhancementPort } from "./ports.js";

interface SeedRow {
  record_id: string;
  dataset_id: string;
  dataset_name: string;
  keyword: string;
  source_kind: "MANUAL" | "GENERIC_FILE" | "BAIDU_KEYWORD" | "CUSTOMER_HISTORY" | "OTHER_PROVIDER";
  evidence_id: string | null;
  metric_kind: string | null;
  metric_value: string | number | null;
  source_reference: string | null;
  observed_at: Date | string | null;
  evidence_source: string | null;
}

const SOURCE_LABELS: Readonly<Record<SeedRow["source_kind"], string>> = {
  MANUAL: "人工关键词",
  GENERIC_FILE: "通用关键词文件",
  BAIDU_KEYWORD: "百度关键词数据",
  CUSTOMER_HISTORY: "客户历史需求数据",
  OTHER_PROVIDER: "其他真实数据来源",
};

/**
 * Projects the generic Keyword Core into optional knowledge-opportunity seeds.
 * Demand evidence remains separate and is admitted only when it is a persisted, source-matched
 * evidence row. A manual keyword can therefore never become verified demand evidence.
 */
export class PgOptionalKeywordEnhancementPort implements OptionalKeywordEnhancementPort {
  constructor(private readonly db: Queryable) {}

  async load(scope: {
    readonly clientOrganizationId: string;
    readonly projectId: string;
  }): Promise<readonly OptionalKeywordSeed[]> {
    const result = await this.db.query<SeedRow>(
      `SELECT r.id AS record_id,d.id AS dataset_id,d.name AS dataset_name,r.keyword,r.source_kind,
              e.id AS evidence_id,e.metric_kind,e.metric_value,e.source_reference,e.observed_at,
              e.source_kind AS evidence_source
       FROM keyword_dataset d
       JOIN keyword_record r
         ON r.dataset_id=d.id
        AND r.client_organization_id=d.client_organization_id
        AND r.project_id=d.project_id
       LEFT JOIN demand_evidence e
         ON e.keyword_record_id=r.id
        AND e.client_organization_id=r.client_organization_id
        AND e.project_id=r.project_id
        AND e.source_kind=r.source_kind
        AND r.source_kind <> 'MANUAL'
       WHERE d.client_organization_id=$1 AND d.project_id=$2 AND d.status='ACTIVE'
       ORDER BY d.created_at,d.id,r.created_at,r.id,e.recorded_at,e.id`,
      [scope.clientOrganizationId, scope.projectId],
    );

    const seeds = new Map<string, { seed: OptionalKeywordSeed; evidence: OptionalDemandEvidenceSeed[] }>();
    for (const row of result.rows) {
      let grouped = seeds.get(row.record_id);
      if (!grouped) {
        const evidence: OptionalDemandEvidenceSeed[] = [];
        grouped = {
          evidence,
          seed: {
            text: row.keyword,
            origin: row.source_kind === "MANUAL" ? "MANUAL" : "DATASET",
            sourceRef: `${row.source_kind}:${row.dataset_id}:${row.record_id}`,
            evidence,
          },
        };
        seeds.set(row.record_id, grouped);
      }
      if (
        row.evidence_id &&
        row.source_kind !== "MANUAL" &&
        row.evidence_source === row.source_kind &&
        row.metric_kind &&
        row.metric_value !== null &&
        row.source_reference
      ) {
        grouped.evidence.push({
          field: row.metric_kind,
          value: Number(row.metric_value),
          sourceLabel: `${SOURCE_LABELS[row.source_kind]}：${row.dataset_name}`,
          ...(row.observed_at
            ? { observedAt: new Date(row.observed_at).toISOString() }
            : {}),
          verified: true,
        });
      }
    }
    return [...seeds.values()].slice(0, 100).map((item) => item.seed);
  }
}
