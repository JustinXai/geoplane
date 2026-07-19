import { describe, expect, it } from "vitest";
import { derivePlatformOpsOverview, type PlatformOpsOverviewFacts } from "../../../src/runtime/read-models/platform-ops-overview.js";

const project = { id: "project-1", clientOrganizationId: "client-1", projectName: "增长项目", clientName: "制造企业" };
const article = (overrides: Partial<{ approved: boolean; inReview: boolean; deliveredAt: string|null }>) => ({
  articleDraftId: crypto.randomUUID(), projectId: project.id, title: "内容",
  approved: false, inReview: false, deliveredAt: null, publicationRegisteredAt: null, ...overrides,
});

function facts(): PlatformOpsOverviewFacts {
  return {
    agencies: 2,
    clients: 3,
    projects: [project],
    deliveriesByProject: new Map([[project.id, [article({ inReview: true }), article({ approved: true })]]]),
    accounts: {
      accounts: [{
        id: "account-1", platformCode: "DOUBAO", displayLabel: "Sample Account Fixture", accountType: "AI_PLATFORM_ACCOUNT",
        ownership: "PLATFORM_OWNED", credentialConfigured: true, credentialStatus: "VERIFIED", status: "ACTIVE",
        operationMode: "MANUAL_OPERATION", authorizationStatus: "AUTHORIZED", assignmentCount: 1,
        authorizedProjects: [], healthStatus: "DEGRADED", riskStatus: "ATTENTION", lastException: null,
        lastCheckedAt: null, pendingTaskCount: 2, failedTaskCount: 1, lastVerifiedAt: null, updatedAt: new Date(0).toISOString(),
      }],
      totals: { all: 1, platformOwned: 1, agencyOwned: 0, clientOwned: 0, needsAttention: 1, pendingTasks: 2, failedTasks: 1 },
    },
  };
}

describe("平台运营总览真实指标", () => {
  it("按内容状态和账号任务推导主系统待办", () => {
    const model = derivePlatformOpsOverview(facts());
    expect(model.totals).toEqual({ agencies: 2, clients: 3, activeProjects: 1, pendingItems: 4 });
    expect(model.queues.contentReview).toEqual([{ projectId: project.id, projectName: project.projectName, clientName: project.clientName, count: 1 }]);
    expect(model.queues.delivery[0]?.count).toBe(1);
    expect(model.risks.failedAccountTasks).toBe(1);
  });

  it("已交付内容不进入待办", () => {
    const base = facts();
    const model = derivePlatformOpsOverview({
      ...base,
      deliveriesByProject: new Map([[project.id, [article({ approved: true, deliveredAt: new Date().toISOString() })]]]),
    });
    expect(model.queues.delivery).toHaveLength(0);
  });
});
