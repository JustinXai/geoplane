import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("用户问题工作台闭环", () => {
  it("正式页面不再把真实人工确认能力标记为尚未开放", () => {
    const page = readFileSync(resolve(root, "src/app/app/questions/page.tsx"), "utf8");
    const workspace = readFileSync(resolve(root, "src/components/client-runtime/ClientQuestionWorkspace.tsx"), "utf8");
    const history = readFileSync(resolve(root, "src/components/account-keyword-runtime/KeywordExpansionHistory.tsx"), "utf8");
    expect(page).not.toContain("尚未开放");
    expect(workspace).toContain("KeywordExpansionHistory");
    expect(workspace).toContain("KnowledgeFirstQuestionWorkspace");
    expect(history).toContain("confirmExpansion");
    expect(history).toContain("removeExpansion");
  });

  it("代理商只从授权项目选择器进入问题人工确认", () => {
    const page = readFileSync(resolve(root, "src/app/agency/keyword-questions/page.tsx"), "utf8");
    expect(page).toContain("AuthorizedProjectWorkspace");
    expect(page).toContain("questionsOnly");
  });

  it("无关键词时提供基于企业知识生成问题的真实入口", () => {
    const component = readFileSync(resolve(root, "src/components/client-runtime/KnowledgeFirstQuestionWorkspace.tsx"), "utf8");
    expect(component).toContain("基于企业知识生成用户问题");
    expect(component).toContain("关键词数据是可选增强项");
    expect(component).toContain("previewKnowledgeOpportunities");
    expect(component).toContain("confirmKnowledgeOpportunity");
  });
});
