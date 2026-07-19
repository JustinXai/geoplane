import { describe, expect, it } from "vitest";
import type { DbQueryResult, SqlParam } from "../../../src/persistence/database-port.js";
import { readBaiduKeywordOverview } from "../../../src/runtime/read-models/domestic-workspaces.js";

describe("百度关键词工作台读取模型", () => {
  it("始终以客户和项目双重范围读取，并汇总真实记录", async () => {
    const calls: { sql: string; params: readonly SqlParam[] }[] = [];
    const db = { query: async <T>(sql: string, params: readonly SqlParam[] = []): Promise<DbQueryResult<T>> => {
      calls.push({ sql, params });
      if (sql.includes("FROM keyword_reference_source_import i")) return { rows: [{
        id: "import-a", source_file_name: "baidu.csv", source_format: "CSV", status: "COMPLETED",
        parsed_count: 2, rejected_count: 1, snapshot_version: 3, demand_observation_count: 1,
        sealed_at: "2026-07-19T12:00:00.000Z",
      }] as T[], rowCount: 1 };
      if(sql.includes("FROM keyword_raw_observation r")) return { rows: [
        { id: "raw-1", normalized_form_id:"form-1",snapshot_id:"snapshot-a",snapshot_version:3,import_id: "import-a", raw_keyword: "GEO 服务", normalized_keyword: "geo 服务", seed_keyword: "GEO", metric_value: "19", evidence_status: "OBSERVED_DEMAND", observed_at: "2026-07-19T12:00:00.000Z" },
        { id: "raw-2", normalized_form_id:"form-2",snapshot_id:"snapshot-a",snapshot_version:3,import_id: "import-a", raw_keyword: "GEO 公司", normalized_keyword: "geo 公司", seed_keyword: "GEO", metric_value: null, evidence_status: null, observed_at: "2026-07-19T12:00:00.000Z" },
      ] as T[], rowCount: 2 };
      if(sql.includes("FROM keyword_family_draft f")) return {rows:[] as T[],rowCount:0};
      return {rows:[{version:null}] as T[],rowCount:1};
    }};

    const model = await readBaiduKeywordOverview(db, "client-a", "project-a");

    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.params[0] === "client-a" && call.params[1] === "project-a")).toBe(true);
    expect(model.totals).toEqual({ imports: 1, keywords: 2, withObservedDemand: 1, rejectedRows: 1,pendingReview:0,confirmed:0,changesRequested:0,rejected:0 });
    expect(model.nextPackageVersion).toBe(1);
    expect(model.keywords[0]).toMatchObject({ importId: "import-a", demandValue: 19, demandEvidence: "OBSERVED_DEMAND" });
    expect(model.capabilityGaps).toContain("百度推荐出价尚未接入");
    expect(JSON.stringify(model)).not.toContain("source_manifest_hash");
  });
});
