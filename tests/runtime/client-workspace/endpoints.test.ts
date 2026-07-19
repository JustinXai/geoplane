/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — each screen's loader calls the correct real route
 * (path + GET), and the composite project-scoped loaders resolve the active project first,
 * propagate a failed project load, and short-circuit an empty project list.
 */
import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "../../../src/lib/api-client/http.js";
import type { ProjectViewV1 } from "../../../src/runtime/api-contracts/index.js";
import {
  loadAccount,
  loadActiveProjectDeliveries,
  loadActiveProjectKeywords,
  loadActiveProjectOpportunities,
  loadDeliveries,
  loadKeywordQuestions,
  loadKnowledgeIssues,
  loadKnowledgePackage,
  loadKnowledgeProgress,
  loadBaiduKeywordProgress,
  loadExpansionProgress,
  loadProbeProgress,
  loadOpportunities,
  loadProjects,
} from "../../../src/components/client-runtime/endpoints.js";
import { fakeApiClient } from "./fake-api-client.js";

const PROJECT: ProjectViewV1 = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "示例项目",
  clientOrganizationId: "22222222-2222-2222-2222-222222222222",
  clientOrganizationName: "示例企业",
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("client-workspace loaders build the expected real route (path + GET)", () => {
  const cases: ReadonlyArray<{
    name: string;
    run: (client: ReturnType<typeof fakeApiClient>["client"]) => Promise<unknown>;
    path: string;
  }> = [
    { name: "loadAccount", run: (c) => loadAccount(c), path: "/api/account" },
    { name: "loadProjects", run: (c) => loadProjects(c), path: "/api/projects" },
    {
      name: "loadKnowledgePackage (encoded)",
      run: (c) => loadKnowledgePackage("kp 1", c),
      path: "/api/knowledge/packages/kp%201",
    },
    {
      name: "loadKnowledgeIssues",
      run: (c) => loadKnowledgeIssues("kp1", c),
      path: "/api/knowledge/packages/kp1/issues",
    },
    {
      name: "loadKeywordQuestions",
      run: (c) => loadKeywordQuestions("proj", c),
      path: "/api/projects/proj/keyword-questions",
    },
    {
      name: "loadDeliveries",
      run: (c) => loadDeliveries("proj", c),
      path: "/api/projects/proj/deliveries",
    },
    {
      name: "loadOpportunities",
      run: (c) => loadOpportunities("proj", c),
      path: "/api/projects/proj/opportunities",
    },
    { name:"loadKnowledgeProgress",run:(c)=>loadKnowledgeProgress("proj 1",c),path:"/api/projects/proj%201/knowledge-progress" },
    { name:"loadBaiduKeywordProgress",run:(c)=>loadBaiduKeywordProgress("proj",c),path:"/api/keywords/projects/proj/overview" },
    { name:"loadExpansionProgress",run:(c)=>loadExpansionProgress("proj",c),path:"/api/keyword-expansion/projects/proj" },
    { name:"loadProbeProgress",run:(c)=>loadProbeProgress("proj",c),path:"/api/probes/projects/proj/manual-samples" },
  ];

  for (const { name, run, path } of cases) {
    it(`${name} -> GET ${path}`, async () => {
      const { client, calls } = fakeApiClient();
      await run(client);
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call).toBeDefined();
      if (!call) throw new Error("expected a recorded call");
      expect(call.path).toBe(path);
      expect(call.method).toBe("GET");
    });
  }
});

describe("composite project-scoped loaders resolve the active project first", () => {
  it("keywords: /api/projects then the active project's keyword-questions", async () => {
    const { client, calls } = fakeApiClient({
      "/api/projects": ok<readonly ProjectViewV1[]>([PROJECT]),
      [`/api/projects/${PROJECT.id}/keyword-questions`]: ok([]),
    });
    const result = await loadActiveProjectKeywords(client);
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual([
      "/api/projects",
      `/api/projects/${PROJECT.id}/keyword-questions`,
    ]);
  });

  it("deliveries: picks the FIRST project by default when several exist", async () => {
    const second: ProjectViewV1 = { ...PROJECT, id: "33333333-3333-3333-3333-333333333333" };
    const { client, calls } = fakeApiClient({
      "/api/projects": ok<readonly ProjectViewV1[]>([PROJECT, second]),
      [`/api/projects/${PROJECT.id}/deliveries`]: ok([]),
    });
    await loadActiveProjectDeliveries(client);
    expect(calls[1]?.path).toBe(`/api/projects/${PROJECT.id}/deliveries`);
  });

  it("opportunities: propagates a forbidden project load without a second call", async () => {
    const { client, calls } = fakeApiClient({
      "/api/projects": err("FORBIDDEN", "denied") as Result<readonly ProjectViewV1[]>,
    });
    const result = await loadActiveProjectOpportunities(client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/projects");
  });

  it("keywords: an empty project list yields an empty payload and no second call", async () => {
    const { client, calls } = fakeApiClient({
      "/api/projects": ok<readonly ProjectViewV1[]>([]),
    });
    const result = await loadActiveProjectKeywords(client);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
