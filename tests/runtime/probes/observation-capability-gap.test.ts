import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOMESTIC_GEO_UI_CAPABILITIES } from "../../../src/runtime/ui-adapters/capabilities.js";

describe("国内 AI 检测结构化结果能力边界", () => {
  it("冻结的 0013 只承载原始样本，不把证据引用或回答正文冒充结构化标注", () => {
    const migration = readFileSync("migrations/0013_china_ai_probe_runtime.sql", "utf8");

    expect(migration).toContain("CREATE TABLE raw_probe_result");
    expect(migration).toContain("screenshot_reference TEXT NULL");
    expect(migration).toContain("answer_text TEXT NULL");
    expect(migration).not.toMatch(/brand_mention|recommendation|answer_position|citation_judg|probe_annotation|metric_snapshot/i);
  });

  it("能力目录继续将人工标注和效果报告标为缺口", () => {
    const annotations = DOMESTIC_GEO_UI_CAPABILITIES.find((item) => item.key === "probe.annotations");
    const report = DOMESTIC_GEO_UI_CAPABILITIES.find((item) => item.key === "probe.report-metrics");

    expect(annotations).toMatchObject({ state: "BACKEND_CAPABILITY_GAP" });
    expect(report).toMatchObject({ state: "BACKEND_CAPABILITY_GAP" });
  });

  it("正式页面明确说明客户报告不生成且不得从回答摘要推测指标", () => {
    const workspace = readFileSync("src/components/probe-report/ManualProbeWorkspace.tsx", "utf8");

    expect(workspace).toContain("品牌提及、推荐情况、回答位置和引用判断尚不能持久保存");
    expect(workspace).toContain("客户效果报告暂不生成");
    expect(workspace).toContain("不会根据回答摘要推测指标");
  });
});
