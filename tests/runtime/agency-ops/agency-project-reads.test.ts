/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — read-only per-client preview aggregation
 * (deliveries / review-queue / keyword-questions) across the agency's authorized projects.
 * Pure-function tests over a fake ApiClient.
 */
import { describe, expect, it } from "vitest";
import { selectAsyncState } from "../../../src/components/runtime/async-state.js";
import {
  listClientDeliveries,
  listClientKeywordQuestions,
  listClientReviewQueue,
} from "../../../src/components/agency-runtime/agency-api.js";
import {
  isAggregateEmpty,
  loadAgencyProjectReads,
  totalRows,
} from "../../../src/components/agency-runtime/project-reads.js";
import type {
  ArticleDeliveryViewV1,
  ProjectViewV1,
} from "../../../src/runtime/api-contracts/index.js";
import { makeFakeApiClient, type RecordedCall } from "./fake-api-client.js";

const PROJECTS: readonly ProjectViewV1[] = [
  {
    id: "PRJ-1",
    name: "项目一",
    clientOrganizationId: "org-client-active-1",
    clientOrganizationName: "示例客户企业",
    createdAt: "2026-07-01",
  },
  {
    id: "PRJ-2",
    name: "项目二",
    clientOrganizationId: "org-client-active-1",
    clientOrganizationName: "示例客户企业",
    createdAt: "2026-07-02",
  },
];

const DELIVERY: ArticleDeliveryViewV1 = {
  id: "DLV-1",
  projectId: "PRJ-1",
  title: "交付一",
  status: "DELIVERED",
  deliveredAt: "2026-07-10",
  publicationRegisteredAt: null,
};

describe("loadAgencyProjectReads — aggregate over authorized projects", () => {
  it("lists projects first, then reads each project on its scoped path", async () => {
    const { client, calls } = makeFakeApiClient((call: RecordedCall) => {
      if (call.path === "/api/projects") return { ok: true, data: PROJECTS };
      if (call.path === "/api/projects/PRJ-1/deliveries") return { ok: true, data: [DELIVERY] };
      if (call.path === "/api/projects/PRJ-2/deliveries") return { ok: true, data: [] };
      return undefined;
    });

    const result = await loadAgencyProjectReads<ArticleDeliveryViewV1>(listClientDeliveries, client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.project.id).toBe("PRJ-1");
      expect(result.data[0]?.items).toHaveLength(1);
      expect(totalRows(result.data)).toBe(1);
      expect(isAggregateEmpty(result.data)).toBe(false);
    }

    expect(calls[0]?.path).toBe("/api/projects");
    const paths = calls.map((c) => c.path);
    expect(paths).toContain("/api/projects/PRJ-1/deliveries");
    expect(paths).toContain("/api/projects/PRJ-2/deliveries");
  });

  it("no authorized projects -> ok([]) -> empty state", async () => {
    const { client } = makeFakeApiClient({ "GET /api/projects": { ok: true, data: [] } });
    const result = await loadAgencyProjectReads<ArticleDeliveryViewV1>(listClientDeliveries, client);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isAggregateEmpty(result.data)).toBe(true);
    expect(selectAsyncState({ result, isEmpty: isAggregateEmpty }).status).toBe("empty");
  });

  it("a failing project list propagates verbatim and reads no project (fail-closed)", async () => {
    const { client, calls } = makeFakeApiClient({
      "GET /api/projects": { ok: false, code: "FORBIDDEN", message: "no access" },
    });
    const result = await loadAgencyProjectReads<ArticleDeliveryViewV1>(listClientDeliveries, client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    expect(calls).toHaveLength(1);
  });

  it("a FORBIDDEN on one project short-circuits — errors are never swallowed into an empty list", async () => {
    const { client, calls } = makeFakeApiClient((call: RecordedCall) => {
      if (call.path === "/api/projects") return { ok: true, data: PROJECTS };
      if (call.path === "/api/projects/PRJ-1/deliveries")
        return { ok: false, code: "FORBIDDEN", message: "cross-tenant" };
      if (call.path === "/api/projects/PRJ-2/deliveries") return { ok: true, data: [DELIVERY] };
      return undefined;
    });

    const result = await loadAgencyProjectReads<ArticleDeliveryViewV1>(listClientDeliveries, client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    expect(selectAsyncState({ result, isEmpty: isAggregateEmpty }).status).toBe("forbidden");
    // Short-circuited before reaching PRJ-2.
    expect(calls.map((c) => c.path)).not.toContain("/api/projects/PRJ-2/deliveries");
  });
});

describe("per-project readers hit the correct scoped geo paths", () => {
  it("review-queue reader uses /api/projects/{id}/review-queue", async () => {
    const { client, calls } = makeFakeApiClient((call: RecordedCall) =>
      call.path === "/api/projects/PRJ-9/review-queue" ? { ok: true, data: [] } : undefined,
    );
    await listClientReviewQueue("PRJ-9", client);
    expect(calls[0]?.path).toBe("/api/projects/PRJ-9/review-queue");
    expect(calls[0]?.method).toBe("GET");
  });

  it("keyword-questions reader uses /api/projects/{id}/keyword-questions", async () => {
    const { client, calls } = makeFakeApiClient((call: RecordedCall) =>
      call.path === "/api/projects/PRJ-9/keyword-questions" ? { ok: true, data: [] } : undefined,
    );
    await listClientKeywordQuestions("PRJ-9", client);
    expect(calls[0]?.path).toBe("/api/projects/PRJ-9/keyword-questions");
  });

  it("deliveries reader url-encodes the project id", async () => {
    const { client, calls } = makeFakeApiClient(() => ({ ok: true, data: [] }));
    await listClientDeliveries("a/b", client);
    expect(calls[0]?.path).toBe("/api/projects/a%2Fb/deliveries");
  });
});
