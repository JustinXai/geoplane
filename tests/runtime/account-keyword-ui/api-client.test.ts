import { describe, expect, it } from "vitest";
import type { ApiClient } from "../../../src/lib/api-client/http.js";
import { accountKeywordApi } from "../../../src/components/account-keyword-runtime/api.js";

describe("账号与关键词界面真实接口接线", () => {
  it("账号登记只提交允许的业务字段", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client: ApiClient = { request: async (path, options) => {
      calls.push({ path, body: options?.body });
      return { ok: true, data: {} } as never;
    } };
    await accountKeywordApi.registerAccount({
      platformCode: "BAIDU_BAIPIN",
      displayLabel: "品牌内容账号",
      accountType: "CONTENT_PLATFORM_ACCOUNT",
      ownership: "CLIENT_OWNED",
    }, client);
    expect(calls).toEqual([{ path: "/api/accounts", body: {
      action: "REGISTER",
      platformCode: "BAIDU_BAIPIN",
      displayLabel: "品牌内容账号",
      accountType: "CONTENT_PLATFORM_ACCOUNT",
      ownership: "CLIENT_OWNED",
    } }]);
  });

  it("拓词人工决定使用逐条受控路由并编码记录标识", async () => {
    const paths: string[] = [];
    const client: ApiClient = { request: async (path) => {
      paths.push(path);
      return { ok: true, data: {} } as never;
    } };
    await accountKeywordApi.confirmExpansion("候选/1", "确认用于后续问题整理", client);
    await accountKeywordApi.removeExpansion("候选/2", "与业务范围不符", client);
    expect(paths).toEqual([
      "/api/keyword-expansion/candidates/%E5%80%99%E9%80%89%2F1/confirm",
      "/api/keyword-expansion/candidates/%E5%80%99%E9%80%89%2F2/delete",
    ]);
  });

  it("按项目读取已保存批次，刷新后继续展示真实状态", async () => {
    const paths: string[] = [];
    const client: ApiClient = { request: async (path) => {
      paths.push(path);
      return { ok: true, data: [] } as never;
    } };
    await accountKeywordApi.listExpansions("项目/甲", client);
    expect(paths).toEqual(["/api/keyword-expansion/projects/%E9%A1%B9%E7%9B%AE%2F%E7%94%B2"]);
  });
});
