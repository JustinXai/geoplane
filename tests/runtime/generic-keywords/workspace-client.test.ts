import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../../../src/lib/api-client/http.js";
import { createGenericKeywordApi } from "../../../src/lib/api-client/generic-keywords/index.js";
import { provided } from "../../../src/components/generic-keyword-runtime/display.js";

describe("通用关键词与需求数据工作台", () => {
  it("只通过薄客户端调用预留的通用关键词路由", async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    const client: ApiClient = { request: async (path, options) => {
      calls.push({ path, ...(options?.method ? { method: options.method } : {}), ...(options?.body ? { body: options.body } : {}) });
      return { ok: true, data: {} } as never;
    } };
    const api = createGenericKeywordApi(client);
    await api.loadWorkspace("项目/甲");
    await api.createDataset({ projectId: "p1", name: "手动关键词", source: "MANUAL" });
    await api.addManualKeyword({ projectId: "p1", datasetId: "数据集/1", keyword: "企业服务" });
    await api.importFile({ projectId: "p1", datasetId: "d1", source: "GENERIC_FILE", fileName: "keywords.csv", base64: "YQ==" });
    const review = await api.createReviewPackage({ projectId: "p1", datasetId: "d1", keywordRecordIds: ["记录/1"], version: 1 });
    expect(review.ok).toBe(true);
    await api.decide({ projectId: "p1", reviewPackageId: "审核包/1", keywordRecordId: "记录/1", decision: "CONFIRMED" });
    await api.archiveDataset({ projectId: "p1", datasetId: "数据集/1" });
    expect(calls.map((item) => item.path)).toEqual([
      "/api/generic-keywords/projects/%E9%A1%B9%E7%9B%AE%2F%E7%94%B2",
      "/api/generic-keywords/datasets",
      "/api/generic-keywords/datasets/%E6%95%B0%E6%8D%AE%E9%9B%86%2F1/records",
      "/api/generic-keywords/imports",
      "/api/generic-keywords/review-packages",
      "/api/generic-keywords/review-packages/%E5%AE%A1%E6%A0%B8%E5%8C%85%2F1/decisions",
      "/api/generic-keywords/datasets/%E6%95%B0%E6%8D%AE%E9%9B%86%2F1/archive",
    ]);
  });

  it("缺失业务字段展示未提供而不是零", () => {
    expect(provided(undefined)).toBe("未提供");
    expect(provided(null)).toBe("未提供");
    expect(provided(0)).toBe("0");
  });

  it("提供双入口、来源筛选、人工决定和真实归档缺口", async () => {
    const source = await readFile(new URL("../../../src/components/generic-keyword-runtime/GenericKeywordWorkspace.tsx", import.meta.url), "utf8");
    for (const text of ["基于企业知识生成用户问题", "导入或手动添加关键词", "通用关键词文件", "百度关键词兼容导入", "全部来源", "全部数据集", "全部批次", "确认", "拒绝", "归档数据集"]) expect(source).toContain(text);
    expect(source).not.toMatch(/搜索量[^\n]*\?\?\s*0|竞价[^\n]*\?\?\s*0|竞争度[^\n]*\?\?\s*0/);
  });

  it("三角色正式页面统一为关键词与需求数据", async () => {
    const paths = ["app/app/keywords/page.tsx", "app/agency/baidu-keywords/page.tsx", "app/ops/keywords/page.tsx"];
    for (const path of paths) {
      const page = await readFile(new URL(`../../../src/${path}`, import.meta.url), "utf8");
      expect(page).toContain("GenericKeyword");
      expect(page).not.toContain("<h1>百度关键词</h1>");
    }
  });
});
