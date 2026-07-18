import { describe, expect, it } from "vitest";
import {
  createApiClient,
  type FetchLike,
  type HttpResponseLike,
} from "../../../src/lib/api-client/http.js";
import {
  getAccount,
  getAgencyClients,
  getKnowledgePackage,
  getProject,
  listArticleDeliveries,
  listAuditEvents,
  listKeywordQuestions,
  listKnowledgeIssues,
  listKnowledgePackages,
  listOpportunities,
  listProjects,
  listReviewDecisions,
} from "../../../src/lib/api-client/endpoints.js";
import { apiOk } from "../../../src/runtime/api-contracts/index.js";

/** Fake fetch that records the requested URL + method and echoes a fixed ok payload. */
function recordingClient(payload: unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: (init?.method as string) ?? "GET" });
    const response: HttpResponseLike = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(apiOk(payload))),
    };
    return Promise.resolve(response);
  };
  return { client: createApiClient({ fetch: fetchImpl }), calls };
}

describe("endpoint functions build the expected path + GET method", () => {
  const cases: ReadonlyArray<{ name: string; run: (c: ReturnType<typeof recordingClient>["client"]) => Promise<unknown>; url: string }> = [
    { name: "getAccount", run: (c) => getAccount(c), url: "/api/account" },
    { name: "listProjects", run: (c) => listProjects(c), url: "/api/projects" },
    { name: "getProject", run: (c) => getProject("p 1", c), url: "/api/projects/p%201" },
    { name: "listKnowledgePackages", run: (c) => listKnowledgePackages("proj", c), url: "/api/projects/proj/knowledge-packages" },
    { name: "getKnowledgePackage", run: (c) => getKnowledgePackage("kp1", c), url: "/api/knowledge-packages/kp1" },
    { name: "listKnowledgeIssues", run: (c) => listKnowledgeIssues("kp1", c), url: "/api/knowledge-packages/kp1/issues" },
    { name: "listKeywordQuestions", run: (c) => listKeywordQuestions("proj", c), url: "/api/projects/proj/keyword-questions" },
    { name: "listOpportunities", run: (c) => listOpportunities("proj", c), url: "/api/projects/proj/opportunities" },
    { name: "listReviewDecisions", run: (c) => listReviewDecisions("proj", c), url: "/api/projects/proj/review-decisions" },
    { name: "listArticleDeliveries", run: (c) => listArticleDeliveries("proj", c), url: "/api/projects/proj/deliveries" },
    { name: "getAgencyClients", run: (c) => getAgencyClients(c), url: "/api/agency/clients" },
    { name: "listAuditEvents", run: (c) => listAuditEvents(c), url: "/api/ops/audit-events" },
  ];

  for (const { name, run, url } of cases) {
    it(`${name} -> GET ${url}`, async () => {
      const { client, calls } = recordingClient({ ok: 1 });
      await run(client);
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call).toBeDefined();
      if (!call) throw new Error("expected a captured call");
      expect(call.url).toBe(url);
      expect(call.method).toBe("GET");
    });
  }

  it("returns the typed success payload", async () => {
    const account = {
      userId: "u1",
      email: "a@b.com",
      displayName: null,
      role: "CLIENT_OWNER",
      surface: "client",
      organizationId: "o1",
      organizationName: "Org",
      organizationType: "CLIENT",
      activeClientOrganizationId: "c1",
    };
    const { client } = recordingClient(account);
    const result = await getAccount(client);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.email).toBe("a@b.com");
    }
  });
});
