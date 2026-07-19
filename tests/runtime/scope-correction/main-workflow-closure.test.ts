import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AGENCY_WORKFLOW_ORDER } from "../../../src/runtime/agency-delivery/contracts.js";

describe("主系统范围收口回归", () => {
  it("零关键词数据集不会阻断拓词、内容、报告与交付主链", () => {
    expect(AGENCY_WORKFLOW_ORDER).not.toContain("BAIDU_KEYWORDS");
    expect(AGENCY_WORKFLOW_ORDER).not.toContain("CHINA_AI_PROBE");
    expect(AGENCY_WORKFLOW_ORDER.slice(4)).toEqual([
      "AI_EXPANSION",
      "USER_QUESTION_CONFIRMATION",
      "CONTENT_TASK",
      "CONTENT_REVIEW",
      "REPORT",
      "DELIVERY",
      "RETROSPECTIVE",
    ]);
  });

  it("客户首页不再呈现百度 Core 或独立检测主指标", async () => {
    const source = await readFile(new URL("../../../src/app/app/page.tsx", import.meta.url), "utf8");
    const viewModel = await readFile(new URL("../../../src/components/client-runtime/overview-view-model.ts", import.meta.url), "utf8");
    expect(`${source}\n${viewModel}`).not.toMatch(/百度关键词进度|百度关键词已入库|国内 AI 检测|Probe/);
    expect(source).toContain("关键词与需求数据");
    expect(source).toContain("基于企业知识生成");
    expect(source).toContain("导入或手动添加");
  });

  it("旧百度阶段只作为兼容事件值保留，并明确标注可选", async () => {
    const contracts = await readFile(new URL("../../../src/runtime/agency-delivery/contracts.ts", import.meta.url), "utf8");
    const actions = await readFile(new URL("../../../src/components/agency-delivery-runtime/AgencyDeliveryActions.tsx", import.meta.url), "utf8");
    expect(contracts).toContain('"BAIDU_KEYWORDS"');
    expect(actions).toContain("关键词与需求数据（可选）");
    expect(actions).not.toContain('label:"百度关键词"');
  });
});
