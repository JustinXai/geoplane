/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — the pure DTO -> display view-model mappers,
 * selectors and label/format helpers map success payloads to the right human-facing view.
 */
import { describe, expect, it } from "vitest";
import type {
  AccountViewV1,
  ArticleDeliveryViewV1,
  KeywordQuestionViewV1,
  KnowledgeIssueViewV1,
  KnowledgePackageViewV1,
  OpportunityViewV1,
  ProjectViewV1,
} from "../../../src/runtime/api-contracts/index.js";
import {
  formatDateLabel,
  isEmptyArray,
  selectActiveProject,
  toAccountSummary,
  toDeliveryRows,
  toKeywordRows,
  toKnowledgeIssueRows,
  toKnowledgePackageReadiness,
  toOpportunityRows,
  toProjectOptions,
  toProjectSummary,
} from "../../../src/components/client-runtime/view-models.js";

function project(overrides: Partial<ProjectViewV1> = {}): ProjectViewV1 {
  return {
    id: "p-1",
    name: "项目一",
    clientOrganizationId: "org-1",
    clientOrganizationName: "企业一",
    createdAt: "2026-07-10T09:00:00.000Z",
    ...overrides,
  };
}

describe("formatDateLabel", () => {
  it("returns the YYYY-MM-DD prefix of an ISO string", () => {
    expect(formatDateLabel("2026-07-10T09:00:00.000Z")).toBe("2026-07-10");
  });
  it("returns an em dash for null / undefined / empty", () => {
    expect(formatDateLabel(null)).toBe("—");
    expect(formatDateLabel(undefined)).toBe("—");
    expect(formatDateLabel("")).toBe("—");
  });
  it("passes a non-ISO string through unchanged", () => {
    expect(formatDateLabel("待定")).toBe("待定");
  });
});

describe("isEmptyArray", () => {
  it("is true only for an empty array", () => {
    expect(isEmptyArray([])).toBe(true);
    expect(isEmptyArray([1])).toBe(false);
  });
});

describe("selectActiveProject (pick first by default)", () => {
  const a = project({ id: "a", name: "A" });
  const b = project({ id: "b", name: "B" });

  it("returns null for an empty list", () => {
    expect(selectActiveProject([])).toBeNull();
  });
  it("returns the first project when no index is given", () => {
    expect(selectActiveProject([a, b])?.name).toBe("A");
  });
  it("returns the indexed project when in range", () => {
    expect(selectActiveProject([a, b], 1)?.name).toBe("B");
  });
  it("falls back to the first project when the index is out of range", () => {
    expect(selectActiveProject([a, b], 9)?.name).toBe("A");
  });

  it("toProjectOptions yields index + name pairs (no UUID)", () => {
    expect(toProjectOptions([a, b])).toEqual([
      { index: 0, label: "A" },
      { index: 1, label: "B" },
    ]);
  });
});

describe("toAccountSummary", () => {
  const base: AccountViewV1 = {
    userId: "u-1",
    email: "owner@example.com",
    displayName: "王五",
    role: "CLIENT_OWNER",
    surface: "client",
    organizationId: "o-1",
    organizationName: "示例企业",
    organizationType: "CLIENT",
    activeClientOrganizationId: "c-1",
  };

  it("maps enums to human labels and keeps the display name", () => {
    const vm = toAccountSummary(base);
    expect(vm).toEqual({
      greetingName: "王五",
      organizationName: "示例企业",
      organizationTypeLabel: "客户企业",
      roleLabel: "客户负责人",
      surfaceLabel: "客户工作台",
    });
  });

  it("falls back to email when displayName is null", () => {
    expect(toAccountSummary({ ...base, displayName: null }).greetingName).toBe("owner@example.com");
  });
});

describe("toProjectSummary", () => {
  it("keeps human fields and formats the created date", () => {
    expect(toProjectSummary(project())).toEqual({
      name: "项目一",
      clientOrganizationName: "企业一",
      createdAtLabel: "2026-07-10",
    });
  });
});

describe("toKnowledgePackageReadiness", () => {
  const pkg: KnowledgePackageViewV1 = {
    id: "kp-1",
    projectId: "p-1",
    title: "产品功能总览",
    status: "IN_REVIEW",
    documentCount: 5,
    openIssueCount: 2,
    updatedAt: "2026-07-12T00:00:00.000Z",
    confirmedAt: null,
  };

  it("maps status label + counts and null confirmedAt", () => {
    expect(toKnowledgePackageReadiness(pkg)).toEqual({
      title: "产品功能总览",
      statusLabel: "审核中",
      documentCount: 5,
      openIssueCount: 2,
      updatedAtLabel: "2026-07-12",
      confirmedAtLabel: null,
    });
  });

  it("formats confirmedAt when present", () => {
    const vm = toKnowledgePackageReadiness({
      ...pkg,
      status: "CONFIRMED",
      confirmedAt: "2026-07-15T10:00:00.000Z",
    });
    expect(vm.statusLabel).toBe("已确认");
    expect(vm.confirmedAtLabel).toBe("2026-07-15");
  });
});

describe("toKnowledgeIssueRows", () => {
  it("maps kind + severity to labels", () => {
    const issues: readonly KnowledgeIssueViewV1[] = [
      {
        id: "i-1",
        packageId: "kp-1",
        kind: "MISSING_INFORMATION",
        severity: "BLOCKER",
        message: "缺少适用范围说明",
        resolved: false,
      },
    ];
    expect(toKnowledgeIssueRows(issues)).toEqual([
      {
        kindLabel: "信息缺失",
        severityLabel: "阻断",
        message: "缺少适用范围说明",
        resolved: false,
      },
    ]);
  });
});

describe("toKeywordRows", () => {
  it("copies keyword + questions + priority", () => {
    const items: readonly KeywordQuestionViewV1[] = [
      { keyword: "如何搭建知识库", userQuestions: ["需要哪些准备？"], priority: 1 },
    ];
    expect(toKeywordRows(items)).toEqual([
      { keyword: "如何搭建知识库", userQuestions: ["需要哪些准备？"], priority: 1 },
    ]);
  });
});

describe("toDeliveryRows", () => {
  it("maps status label and formats dates (em dash for null delivery)", () => {
    const items: readonly ArticleDeliveryViewV1[] = [
      {
        id: "d-1",
        projectId: "p-1",
        title: "企业知识库搭建指南",
        status: "IN_PRODUCTION",
        deliveredAt: null,
        publicationRegisteredAt: null,
      },
    ];
    expect(toDeliveryRows(items)).toEqual([
      {
        title: "企业知识库搭建指南",
        statusLabel: "制作中",
        deliveredAtLabel: "—",
        publicationRegisteredAtLabel: null,
      },
    ]);
  });
});

describe("toOpportunityRows", () => {
  it("maps status label and keeps title + summary", () => {
    const items: readonly OpportunityViewV1[] = [
      {
        id: "opp-1",
        projectId: "p-1",
        title: "关键词内容方向",
        summary: "面向该关键词的内容方向。",
        status: "VALIDATED",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    ];
    expect(toOpportunityRows(items)).toEqual([
      { title: "关键词内容方向", summary: "面向该关键词的内容方向。", statusLabel: "已验证" },
    ]);
  });
});
