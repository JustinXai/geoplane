/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — every wired screen selects the right one of the
 * five async states for loading / empty / error(500) / forbidden(401|403) / success.
 *
 * The loader is driven with the fake ApiClient to produce each Result, then reduced with the
 * shared pure selectAsyncState + the screen's isEmpty predicate (the same pipeline
 * useAsyncData runs). Loading is the undefined-result case.
 */
import { describe, expect, it } from "vitest";
import { err, ok, type ApiClient, type Result } from "../../../src/lib/api-client/http.js";
import { selectAsyncState } from "../../../src/components/runtime/async-state.js";
import type { ProjectViewV1 } from "../../../src/runtime/api-contracts/index.js";
import {
  loadAccount,
  loadActiveProjectDeliveries,
  loadActiveProjectKeywords,
  loadActiveProjectOpportunities,
  loadKnowledgeIssues,
  loadKnowledgePackage,
  loadProjects,
} from "../../../src/components/client-runtime/endpoints.js";
import { isEmptyArray } from "../../../src/components/client-runtime/view-models.js";
import { fakeApiClient } from "./fake-api-client.js";

const PROJECT: ProjectViewV1 = {
  id: "p1",
  name: "项目",
  clientOrganizationId: "org",
  clientOrganizationName: "企业",
  createdAt: "2026-07-10T00:00:00.000Z",
};

const ERROR: Result<never> = err("INTERNAL_ERROR", "boom");
const UNAUTH: Result<never> = err("UNAUTHENTICATED", "login required");
const FORBID: Result<never> = err("FORBIDDEN", "denied");

interface Screen {
  readonly name: string;
  readonly load: (client: ApiClient) => Promise<Result<unknown>>;
  readonly isEmpty?: (data: unknown) => boolean;
  /** Routes that make the loader succeed with a non-empty payload. */
  readonly success: Readonly<Record<string, Result<unknown>>>;
  /** Routes that make the loader succeed with an empty list (undefined when N/A). */
  readonly empty?: Readonly<Record<string, Result<unknown>>>;
  /** The path whose Result decides error/forbidden (the loader's first call). */
  readonly entryPath: string;
}

const isEmpty = (data: unknown): boolean => isEmptyArray(data as readonly unknown[]);

const screens: readonly Screen[] = [
  {
    name: "dashboard account",
    load: (c) => loadAccount(c),
    entryPath: "/api/account",
    success: { "/api/account": ok({ email: "a@b.com" }) },
  },
  {
    name: "dashboard projects",
    load: (c) => loadProjects(c),
    isEmpty,
    entryPath: "/api/projects",
    success: { "/api/projects": ok([PROJECT]) },
    empty: { "/api/projects": ok([]) },
  },
  {
    name: "knowledge package",
    load: (c) => loadKnowledgePackage("kp1", c),
    entryPath: "/api/knowledge/packages/kp1",
    success: { "/api/knowledge/packages/kp1": ok({ title: "包" }) },
  },
  {
    name: "knowledge issues",
    load: (c) => loadKnowledgeIssues("kp1", c),
    isEmpty,
    entryPath: "/api/knowledge/packages/kp1/issues",
    success: { "/api/knowledge/packages/kp1/issues": ok([{ message: "x" }]) },
    empty: { "/api/knowledge/packages/kp1/issues": ok([]) },
  },
  {
    name: "keywords (composite)",
    load: (c) => loadActiveProjectKeywords(c),
    isEmpty,
    entryPath: "/api/projects",
    success: {
      "/api/projects": ok([PROJECT]),
      "/api/projects/p1/keyword-questions": ok([{ keyword: "k", userQuestions: [], priority: 1 }]),
    },
    empty: { "/api/projects": ok([]) },
  },
  {
    name: "delivery (composite)",
    load: (c) => loadActiveProjectDeliveries(c),
    isEmpty,
    entryPath: "/api/projects",
    success: {
      "/api/projects": ok([PROJECT]),
      "/api/projects/p1/deliveries": ok([{ title: "文章" }]),
    },
    empty: { "/api/projects": ok([]) },
  },
  {
    name: "content opportunities (composite)",
    load: (c) => loadActiveProjectOpportunities(c),
    isEmpty,
    entryPath: "/api/projects",
    success: {
      "/api/projects": ok([PROJECT]),
      "/api/projects/p1/opportunities": ok([{ title: "方向" }]),
    },
    empty: { "/api/projects": ok([]) },
  },
];

describe("each wired screen selects the right async state", () => {
  it("loading: an undefined result is the loading state (before the loader resolves)", () => {
    expect(selectAsyncState({ result: undefined }).status).toBe("loading");
  });

  for (const screen of screens) {
    describe(screen.name, () => {
      it("success -> success", async () => {
        const result = await screen.load(fakeApiClient(screen.success).client);
        expect(selectAsyncState({ result, isEmpty: screen.isEmpty }).status).toBe("success");
      });

      if (screen.empty) {
        it("empty payload -> empty", async () => {
          const result = await screen.load(fakeApiClient(screen.empty).client);
          expect(selectAsyncState({ result, isEmpty: screen.isEmpty }).status).toBe("empty");
        });
      }

      it("500 -> error", async () => {
        const result = await screen.load(fakeApiClient({ [screen.entryPath]: ERROR }).client);
        expect(selectAsyncState({ result, isEmpty: screen.isEmpty }).status).toBe("error");
      });

      it("401 -> forbidden", async () => {
        const result = await screen.load(fakeApiClient({ [screen.entryPath]: UNAUTH }).client);
        expect(selectAsyncState({ result, isEmpty: screen.isEmpty }).status).toBe("forbidden");
      });

      it("403 -> forbidden", async () => {
        const result = await screen.load(fakeApiClient({ [screen.entryPath]: FORBID }).client);
        expect(selectAsyncState({ result, isEmpty: screen.isEmpty }).status).toBe("forbidden");
      });
    });
  }
});
