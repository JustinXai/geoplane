import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve("src/app/ops/page.tsx"), "utf8");

describe("平台运营首页产品验收", () => {
  it("展示真实待办、风险、来源和下一步入口", () => {
    for (const label of ["待人工审核内容", "待交付内容", "异常账号", "近七日业务进度", "数据来源", "统计能力边界"]) {
      expect(page).toContain(label);
    }
    expect(page).not.toContain("待执行国内 AI 检测");
    expect(page).not.toContain("暂无可靠统计");
    expect(page).not.toContain("该功能尚未开放");
  });
});
