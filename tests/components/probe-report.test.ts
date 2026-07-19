import { describe, expect, it } from "vitest";
import type { RawProbeResult } from "../../src/runtime/probes/manual-sample.js";
import type { ApiClient } from "../../src/lib/api-client/http.js";
import {
  DOMESTIC_AI_PLATFORMS,
  filterProbeResults,
  listManualProbeSamples,
  recordManualProbeSample,
  summarizeProbeResults,
} from "../../src/components/probe-report/probe-client.js";

const sample = (id: string, outcome: "ANSWERED" | "FAILED"): RawProbeResult => ({
  id, clientOrganizationId: "client", projectId: "project", platform: "DOUBAO",
  collectionMode: "MANUAL_SAMPLE", question: "用户问题", outcome,
  answerText: outcome === "ANSWERED" ? "真实回答" : null, screenshotReference: null,
  failureCode: outcome === "FAILED" ? "ANSWER_NOT_RETURNED" : null, failureMessage: null,
  observedAt: "2026-07-19T10:00:00.000Z", recordedAt: "2026-07-19T10:01:00.000Z",
  recordedByUserId: "operator",
});

describe("国内 AI 人工查询展示模型", () => {
  it("正式界面只提供冻结的四个平台", () => {
    expect(DOMESTIC_AI_PLATFORMS.map((item) => item.code)).toEqual(["DOUBAO", "QWEN", "DEEPSEEK", "YUANBAO"]);
  });

  it("按平台、状态和问题关键词筛选持久化样本", () => {
    const qwen = { ...sample("qwen", "FAILED"), platform: "QWEN" as const, question: "价格是多少？" };
    expect(filterProbeResults([sample("doubao", "ANSWERED"), qwen], {
      platform: "QWEN", outcome: "FAILED", question: "价格",
    })).toEqual([qwen]);
    expect(filterProbeResults([sample("doubao", "ANSWERED"), qwen], {
      platform: "DOUBAO", outcome: "FAILED", question: "",
    })).toEqual([]);
  });

  it("报告只汇总已保存样本，并保持信源引用率未计算", () => {
    expect(summarizeProbeResults([sample("one", "ANSWERED"), sample("two", "FAILED")])).toEqual({
      sampleCount: 2, answeredCount: 1, failedCount: 1,
      managedSourceCitationRate: "尚未计算", reviewStatus: "人工指标复核尚未开放",
    });
  });

  it("读取请求对项目参数编码，并直接使用统一 API 客户端", async () => {
    const calls: Array<{ path: string; options: unknown }> = [];
    const client: ApiClient = { request: async <T,>(path: string, options?: Parameters<ApiClient["request"]>[1]) => {
      calls.push({ path, options });
      return { ok: true, data: [] as T };
    } };
    await listManualProbeSamples("项目/一", client);
    expect(calls).toEqual([{ path: "/api/probes/manual-samples?projectId=%E9%A1%B9%E7%9B%AE%2F%E4%B8%80", options: undefined }]);
  });

  it("写入请求固定为人工采样且不由界面提交客户范围", async () => {
    const calls: Array<{ path: string; options: any }> = [];
    const client: ApiClient = { request: async <T,>(path: string, options?: Parameters<ApiClient["request"]>[1]) => {
      calls.push({ path, options });
      return { ok: true, data: sample("saved", "ANSWERED") as T };
    } };
    await recordManualProbeSample({
      projectId: "project", platform: "QWEN", collectionMode: "MANUAL_SAMPLE",
      question: "问题", outcome: "ANSWERED", answerText: "回答", observedAt: "2026-07-19T10:00:00Z",
    }, client);
    expect(calls[0]?.path).toBe("/api/probes/manual-samples");
    expect(calls[0]?.options.method).toBe("POST");
    expect(calls[0]?.options.body.collectionMode).toBe("MANUAL_SAMPLE");
    expect(calls[0]?.options.body).not.toHaveProperty("clientOrganizationId");
  });
});
