import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOMESTIC_GEO_UI_CAPABILITIES } from "../../../src/runtime/ui-adapters/capabilities.js";
import { OBSERVATION_GAP_DISPOSITION, PROBE_RUNTIME_CLASSIFICATION } from "../../../src/runtime/probes/prototype-boundary.js";

describe("国内 AI 检测结构化结果能力边界", () => {
  it("冻结的 0013 只承载原始样本，不把证据引用或回答正文冒充结构化标注", () => {
    const migration = readFileSync("migrations/0013_china_ai_probe_runtime.sql", "utf8");

    expect(migration).toContain("CREATE TABLE raw_probe_result");
    expect(migration).toContain("screenshot_reference TEXT NULL");
    expect(migration).toContain("answer_text TEXT NULL");
    expect(migration).not.toMatch(/brand_mention|recommendation|answer_position|citation_judg|probe_annotation|metric_snapshot/i);
  });

  it("能力目录将原型及结构化结果缺口归入独立检测系统", () => {
    const annotations = DOMESTIC_GEO_UI_CAPABILITIES.find((item) => item.key === "probe.annotations");
    const report = DOMESTIC_GEO_UI_CAPABILITIES.find((item) => item.key === "probe.report-metrics");

    expect(PROBE_RUNTIME_CLASSIFICATION).toBe("INDEPENDENT_DETECTION_SYSTEM_PROTOTYPE");
    expect(OBSERVATION_GAP_DISPOSITION).toBe("DEFERRED_TO_INDEPENDENT_DETECTION_SYSTEM");
    expect(annotations).toMatchObject({ state: "BACKEND_CAPABILITY_GAP", systemBoundary: PROBE_RUNTIME_CLASSIFICATION, gapDisposition: OBSERVATION_GAP_DISPOSITION });
    expect(report).toMatchObject({ state: "BACKEND_CAPABILITY_GAP", systemBoundary: PROBE_RUNTIME_CLASSIFICATION, gapDisposition: OBSERVATION_GAP_DISPOSITION });
  });

  it("正式页面明确说明客户报告不生成且不得从回答摘要推测指标", () => {
    const workspace = readFileSync("src/components/probe-report/ManualProbeWorkspace.tsx", "utf8");

    expect(workspace).toContain("品牌提及、推荐情况、回答位置和引用判断尚不能持久保存");
    expect(workspace).toContain("客户效果报告暂不生成");
    expect(workspace).toContain("不会根据回答摘要推测指标");
  });
});
