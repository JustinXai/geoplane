import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENCY_WORKSPACE_NAV_LINKS,
  CLIENT_WORKSPACE_NAV_LINKS,
  OPS_WORKSPACE_NAV_LINKS,
} from "../src/lib/workspace-nav.js";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("H2 共享页面呈现约束", () => {
  const uiSource = read("../src/components/ui/index.tsx");
  const cssSource = read("../src/app/globals.css");

  it("指标可呈现数据来源并提供可选来源链接", () => {
    expect(uiSource).toContain("source?:");
    expect(uiSource).toContain("数据来源");
    expect(uiSource).toContain("source.href");
    expect(uiSource).toContain("DataSourceNote");
  });

  it("共享筛选栏包含结果反馈和可点击的清除动作", () => {
    expect(uiSource).toContain("FilterBar");
    expect(uiSource).toContain('aria-label="筛选条件"');
    expect(uiSource).toContain("resultSummary");
    expect(uiSource).toContain("清除筛选");
    expect(cssSource).toContain(".filter-bar");
  });

  it("主要空状态明确呈现原因、显示条件和可点击下一步", () => {
    expect(uiSource).toContain("EmptyState");
    expect(uiSource).toContain("当前原因");
    expect(uiSource).toContain("显示条件");
    expect(uiSource).toContain("action.href");
    expect(uiSource).toContain("action.label");

    const opsState = read("../src/components/ops-runtime/OpsPage.tsx");
    expect(opsState).toContain("当前原因：");
    expect(opsState).toContain("显示条件：");
    expect(opsState).toContain("返回运营总览");
  });

  it("共享正式文案不再使用旧的开放占位提示", () => {
    const sharedSources = [
      uiSource,
      read("../src/components/layout/WorkspaceShell.tsx"),
      read("../src/components/ops-runtime/OpsPage.tsx"),
      read("../src/lib/i18n/zh-CN.ts"),
      read("../src/lib/workspace-nav.ts"),
    ];
    for (const source of sharedSources) {
      expect(source).not.toContain("该功能尚未开放");
      expect(source).not.toContain("内容与信源");
      expect(source).not.toContain("国内 AI 查询");
      expect(source).not.toContain("人工探测");
      expect(source).not.toContain("效果验证");
    }
  });

  it("三角色核心入口使用无项目符号的分组导航", () => {
    expect(cssSource).toMatch(/\.workspace-nav-list\s*\{[^}]*list-style\s*:\s*none/s);
    const arrays = [CLIENT_WORKSPACE_NAV_LINKS, AGENCY_WORKSPACE_NAV_LINKS, OPS_WORKSPACE_NAV_LINKS];
    for (const links of arrays) {
      expect(links.every((item) => Boolean(item.group))).toBe(true);
      expect(links.every((item) => !/^[•·*-]\s/.test(item.label))).toBe(true);
    }
  });
});
