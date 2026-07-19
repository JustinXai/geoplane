import { describe, expect, it } from "vitest";
import type { RawProbeResult } from "../../src/runtime/probes/manual-sample.js";
import { DOMESTIC_AI_PLATFORMS, summarizeProbeResults } from "../../src/components/probe-report/probe-client.js";

const sample = (id: string, outcome: "ANSWERED" | "FAILED"): RawProbeResult => ({
  id, clientOrganizationId: "client", projectId: "project", platform: "DOUBAO",
  collectionMode: "MANUAL_SAMPLE", question: "用户问题", outcome,
  answerText: outcome === "ANSWERED" ? "真实回答" : null, screenshotReference: null,
  failureCode: outcome === "FAILED" ? "ANSWER_NOT_RETURNED" : null, failureMessage: null,
  observedAt: "2026-07-19T10:00:00.000Z", recordedAt: "2026-07-19T10:01:00.000Z",
  recordedByUserId: "operator",
});

describe("国内 AI 人工查询展示模型", () => {
  it("只启用冻结的四个平台，两个保留平台明确停用", () => {
    expect(DOMESTIC_AI_PLATFORMS.filter((item) => item.enabled).map((item) => item.code)).toEqual(["DOUBAO", "QWEN", "DEEPSEEK", "YUANBAO"]);
    expect(DOMESTIC_AI_PLATFORMS.filter((item) => !item.enabled).map((item) => item.code)).toEqual(["KIMI", "WENXIN"]);
  });

  it("报告只汇总已保存样本，并保持信源引用率未计算", () => {
    expect(summarizeProbeResults([sample("one", "ANSWERED"), sample("two", "FAILED")])).toEqual({
      sampleCount: 2, answeredCount: 1, failedCount: 1,
      managedSourceCitationRate: "尚未计算", reviewStatus: "人工指标复核尚未开放",
    });
  });
});
