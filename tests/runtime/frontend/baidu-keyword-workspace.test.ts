import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../../../src/", import.meta.url);

describe("百度关键词正式工作台", () => {
  it("提供项目选择、真实筛选、导入历史和明确空状态", async () => {
    const client = await readFile(new URL("components/client-runtime/ClientBaiduKeywordWorkspace.tsx", root), "utf8");
    const panel = await readFile(new URL("components/account-keyword-runtime/BaiduKeywordProjectPanel.tsx", root), "utf8");
    expect(client).toContain("loadProjects");
    expect(client).toContain("当前项目");
    for (const text of ["导入记录", "搜索关键词", "需求数据", "导入批次", "没有符合当前筛选条件的关键词"]) expect(panel).toContain(text);
    expect(panel).not.toMatch(/Fixture|Sample Local|假数据/);
  });

  it("由服务端分配版本，并让重复导入返回真实已有记录", async () => {
    const route = await readFile(new URL("app/api/keywords/imports/route.ts", root), "utf8");
    expect(route).toContain("max(snapshot_version)");
    expect(route).toContain("findCompletedImportByManifest");
    expect(route).toContain('status:"ALREADY_IMPORTED",importId:existing.id');
    expect(route).not.toContain("body.snapshotVersion");
  });
});
