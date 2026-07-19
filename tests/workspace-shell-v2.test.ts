import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENCY_WORKSPACE_NAV_LINKS,
  CLIENT_WORKSPACE_NAV_LINKS,
  OPS_WORKSPACE_NAV_LINKS,
} from "../src/lib/workspace-nav.js";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("H1 三角色共享工作台壳层", () => {
  it("三角色导航具有业务分组且保持各自边界", () => {
    const surfaces = [
      [CLIENT_WORKSPACE_NAV_LINKS, "/app"],
      [AGENCY_WORKSPACE_NAV_LINKS, "/agency"],
      [OPS_WORKSPACE_NAV_LINKS, "/ops"],
    ] as const;

    for (const [links, prefix] of surfaces) {
      expect(links.length).toBeGreaterThan(0);
      expect(new Set(links.map((item) => item.group)).size).toBeGreaterThan(1);
      expect(links.every((item) => item.group && (item.href === prefix || item.href.startsWith(`${prefix}/`)))).toBe(true);
    }
  });

  it("主导航移除规划页和客户禁用名称", () => {
    const all = [...CLIENT_WORKSPACE_NAV_LINKS, ...AGENCY_WORKSPACE_NAV_LINKS, ...OPS_WORKSPACE_NAV_LINKS];
    const labels = all.map((item) => item.label);
    const hrefs = all.map((item) => item.href);

    expect(labels).not.toContain("内容与信源");
    expect(labels).not.toContain("国内 AI 查询");
    expect(labels).not.toContain("人工探测");
    expect(labels).toContain("国内 AI 检测");
    expect(CLIENT_WORKSPACE_NAV_LINKS.map((item) => item.label)).toEqual(expect.arrayContaining(["内容与交付", "客户报告"]));
    expect(hrefs).not.toContain("/app/performance");
    expect(hrefs).not.toContain("/agency/templates");
    expect(hrefs).not.toContain("/agency/batch-tasks");
    expect(hrefs).not.toContain("/agency/branding");
    expect(hrefs).not.toContain("/ops/models-usage");
    expect(hrefs).not.toContain("/ops/publisher-connectors");
  });

  it("根布局、登录页和共享壳层使用一致系统名称", () => {
    const expectedName = "国内 GEO 运营与交付系统";
    for (const file of ["../src/app/layout.tsx", "../src/app/login/page.tsx", "../src/components/layout/WorkspaceShell.tsx"]) {
      expect(read(file)).toContain(expectedName);
    }
  });

  it("平台、代理商、客户布局全部接入共享壳层", () => {
    for (const file of ["../src/app/app/layout.tsx", "../src/app/agency/layout.tsx", "../src/app/ops/layout.tsx"]) {
      const source = read(file);
      expect(source).toContain("WorkspaceShell");
      expect(source).toMatch(/WORKSPACE_NAV_LINKS/);
    }
  });

  it("共享指标组件支持正常、待处理、风险和异常四种语义", () => {
    const source = read("../src/components/ui/index.tsx");
    expect(source).toContain('"normal" | "pending" | "risk" | "error"');
    expect(source).toContain("data-tone={tone}");
  });
});
