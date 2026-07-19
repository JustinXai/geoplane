import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safeBusinessDisplayName } from "../../../src/runtime/ui-adapters/formatters.js";
import { readPolicyPack } from "../../../src/runtime/read-models/domestic-workspaces.js";
import type { Queryable } from "../../../src/persistence/database-port.js";

describe("formal workspace language projection", () => {
  it("relabels local seed identities without changing ordinary business names", () => {
    expect(safeBusinessDisplayName("Sample Local Agency (Pilot Fixture)")).toBe("本地验收代理商（测试数据）");
    expect(safeBusinessDisplayName("Sample Local Closed Pilot Project", "项目")).toBe("本地验收项目（测试数据）");
    expect(safeBusinessDisplayName("Demo Client")).toBe("本地测试组织（测试数据）");
    expect(safeBusinessDisplayName("华东品牌运营中心")).toBe("华东品牌运营中心");
  });

  it("uses the same business name for domestic AI detection on remediated pages", () => {
    const files = [
      "src/app/agency/deliveries/page.tsx",
      "src/app/agency/manual-probe/page.tsx",
      "src/app/agency/todos/page.tsx",
      "src/app/app/ai-results/page.tsx",
      "src/components/agency-delivery-runtime/AgencyDeliveryActions.tsx",
      "src/components/ops-runtime/OpsManualProbePage.tsx",
    ];
    const visibleSources = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(visibleSources).toContain("国内 AI 检测");
    expect(visibleSources).not.toMatch(/国内 AI 查询|人工探测|AI 查询结果/);
  });

  it("keeps deferred source collection out of the client page title", () => {
    const content = readFileSync("src/app/app/content/page.tsx", "utf8");
    expect(content).toContain("<h1>内容与交付</h1>");
    expect(content).not.toContain("<h1>内容与信源</h1>");
  });
});

describe("industry policy read model", () => {
  it("reports the bound pack, real evaluations and the frozen no-switch reason", async () => {
    const responses = [
      { rows: [{ id: "industry-1", vertical_slug: "medical-aesthetics", vertical_label: "医疗医美" }] },
      { rows: [{ pack_id: "MEDICAL_AESTHETICS_V1", pack_version: 1 }] },
      { rows: [{ category: "EVIDENCE_REQUIREMENT", status: "FAILED", failure_reasons: ["需要补充人工确认"], evaluated_at: "2026-07-19T08:00:00.000Z" }] },
    ];
    const db = { query: async () => responses.shift() ?? { rows: [] } };
    const model = await readPolicyPack(db as unknown as Queryable, "project-1");

    expect(model.pack.packId).toBe("MEDICAL_AESTHETICS_V1");
    expect(model.pack.version).toBe(1);
    expect(model.pack.rules.some((rule) => rule.evaluationMode === "MANUAL_CONFIRMATION")).toBe(true);
    expect(model.recentEvaluations).toEqual([{ category: "EVIDENCE_REQUIREMENT", status: "FAILED", failureReasons: ["需要补充人工确认"], evaluatedAt: "2026-07-19T08:00:00.000Z" }]);
    expect(model.switching.allowed).toBe(false);
    expect(model.switching.reason).toMatch(/行业门禁/);
  });
});
