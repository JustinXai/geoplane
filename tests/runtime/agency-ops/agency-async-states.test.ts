/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — every wired agency screen must render all five
 * async UI states. This asserts the state-selection (the same pure selectAsyncState the pages
 * render through) resolves each of Loading / Empty / Error / Forbidden / Success for the agency
 * payload shapes, using the agency emptiness predicates.
 */
import { describe, expect, it } from "vitest";
import { selectAsyncState } from "../../../src/components/runtime/async-state.js";
import type { Result } from "../../../src/lib/api-client/index.js";
import { isPortfolioEmpty } from "../../../src/components/agency-runtime/client-portfolio.js";
import {
  type AgencyProjectReadGroup,
  isAggregateEmpty,
} from "../../../src/components/agency-runtime/project-reads.js";
import type {
  AgencyClientPortfolioViewV1,
  OpportunityViewV1,
  ProjectViewV1,
} from "../../../src/runtime/api-contracts/index.js";

const PORTFOLIO: AgencyClientPortfolioViewV1 = {
  agencyOrganizationId: "org-agency-1",
  agencyOrganizationName: "示例代理商",
  clients: [
    {
      clientOrganizationId: "org-client-active-1",
      clientOrganizationName: "示例客户企业",
      projectCount: 1,
      openReviewCount: 0,
    },
  ],
};

describe("five async UI states — client portfolio screen", () => {
  it("Loading: no result yet", () => {
    expect(selectAsyncState<AgencyClientPortfolioViewV1>({ result: undefined }).status).toBe(
      "loading",
    );
  });

  it("Success: a populated authorized portfolio", () => {
    const result: Result<AgencyClientPortfolioViewV1> = { ok: true, data: PORTFOLIO };
    expect(selectAsyncState({ result, isEmpty: isPortfolioEmpty }).status).toBe("success");
  });

  it("Empty: an authorized-but-empty portfolio", () => {
    const result: Result<AgencyClientPortfolioViewV1> = {
      ok: true,
      data: { ...PORTFOLIO, clients: [] },
    };
    expect(selectAsyncState({ result, isEmpty: isPortfolioEmpty }).status).toBe("empty");
  });

  it("Forbidden: UNAUTHENTICATED and FORBIDDEN both map to the forbidden state", () => {
    for (const code of ["UNAUTHENTICATED", "FORBIDDEN"] as const) {
      const result: Result<AgencyClientPortfolioViewV1> = { ok: false, code, message: code };
      expect(selectAsyncState({ result }).status).toBe("forbidden");
    }
  });

  it("Error: a non-authorization failure maps to the error state", () => {
    const result: Result<AgencyClientPortfolioViewV1> = {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "boom",
    };
    expect(selectAsyncState({ result }).status).toBe("error");
  });
});

describe("five async UI states — aggregate project-read screens", () => {
  const PROJECT: ProjectViewV1 = {
    id: "PRJ-1",
    name: "项目一",
    clientOrganizationId: "org-client-active-1",
    clientOrganizationName: "示例客户企业",
    createdAt: "2026-07-01",
  };
  const OPPORTUNITY: OpportunityViewV1 = {
    id: "OPP-1",
    projectId: "PRJ-1",
    title: "机会点一",
    summary: "摘要",
    status: "VALIDATED",
    createdAt: "2026-07-05",
  };

  it("Empty when authorized projects have no rows (a project with an empty items list)", () => {
    const result: Result<readonly AgencyProjectReadGroup<OpportunityViewV1>[]> = {
      ok: true,
      data: [{ project: PROJECT, items: [] }],
    };
    expect(selectAsyncState({ result, isEmpty: isAggregateEmpty }).status).toBe("empty");
  });

  it("Success when at least one project has rows", () => {
    const result: Result<readonly AgencyProjectReadGroup<OpportunityViewV1>[]> = {
      ok: true,
      data: [{ project: PROJECT, items: [OPPORTUNITY] }],
    };
    expect(selectAsyncState({ result, isEmpty: isAggregateEmpty }).status).toBe("success");
  });
});
