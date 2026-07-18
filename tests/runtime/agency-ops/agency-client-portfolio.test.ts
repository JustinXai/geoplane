/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — authorized client list + search + assignment
 * isolation. Pure-function tests over a fake ApiClient (no DOM / jsdom).
 */
import { describe, expect, it } from "vitest";
import { selectAsyncState } from "../../../src/components/runtime/async-state.js";
import { getAgencyClients } from "../../../src/components/agency-runtime/agency-api.js";
import {
  filterAuthorizedClients,
  findAuthorizedClient,
  isClientAuthorized,
  isPortfolioEmpty,
  resolveClientSelection,
} from "../../../src/components/agency-runtime/client-portfolio.js";
import type { AgencyClientPortfolioViewV1 } from "../../../src/runtime/api-contracts/index.js";
import { makeFakeApiClient } from "./fake-api-client.js";

// The portfolio a fake GET /api/agency/clients returns is, by construction, ONLY the agency's
// ACTIVE-assigned clients — the route never includes a REVOKED/unassigned client. "org-unassigned"
// below is a client id that is NOT in this authorized set.
const PORTFOLIO: AgencyClientPortfolioViewV1 = {
  agencyOrganizationId: "org-agency-1",
  agencyOrganizationName: "示例代理商",
  clients: [
    {
      clientOrganizationId: "org-client-active-1",
      clientOrganizationName: "示例客户企业",
      projectCount: 1,
      openReviewCount: 2,
    },
    {
      clientOrganizationId: "org-client-active-2",
      clientOrganizationName: "示例制造企业",
      projectCount: 2,
      openReviewCount: 0,
    },
  ],
};

describe("getAgencyClients — endpoint", () => {
  it("issues GET /api/agency/clients exactly once", async () => {
    const { client, calls } = makeFakeApiClient({
      "GET /api/agency/clients": { ok: true, data: PORTFOLIO },
    });
    const result = await getAgencyClients(client);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/agency/clients");
    expect(calls[0]?.method).toBe("GET");
  });

  it("a non-agency caller surfaces FORBIDDEN (forbidden state, never a client list)", async () => {
    const { client } = makeFakeApiClient({
      "GET /api/agency/clients": {
        ok: false,
        code: "FORBIDDEN",
        message: "Only agency members can view the client portfolio.",
      },
    });
    const result = await getAgencyClients(client);
    expect(selectAsyncState({ result }).status).toBe("forbidden");
  });

  it("an empty portfolio maps to the empty state", async () => {
    const empty: AgencyClientPortfolioViewV1 = { ...PORTFOLIO, clients: [] };
    const { client } = makeFakeApiClient({
      "GET /api/agency/clients": { ok: true, data: empty },
    });
    const result = await getAgencyClients(client);
    expect(selectAsyncState({ result, isEmpty: isPortfolioEmpty }).status).toBe("empty");
  });
});

describe("assignment isolation — only ACTIVE-assigned clients are reachable", () => {
  it("an unauthorized client id is absent from the authorized portfolio", () => {
    expect(isClientAuthorized(PORTFOLIO, "org-client-active-1")).toBe(true);
    expect(isClientAuthorized(PORTFOLIO, "org-unassigned")).toBe(false);
    expect(findAuthorizedClient(PORTFOLIO, "org-unassigned")).toBeUndefined();
  });

  it("resolveClientSelection refuses an unauthorized client (defence-in-depth before any POST)", () => {
    const authorized = resolveClientSelection(PORTFOLIO, "org-client-active-2");
    expect(authorized.authorized).toBe(true);
    if (authorized.authorized) {
      expect(authorized.client.clientOrganizationId).toBe("org-client-active-2");
    }

    const denied = resolveClientSelection(PORTFOLIO, "org-unassigned");
    expect(denied.authorized).toBe(false);
  });
});

describe("client search — only ever narrows the authorized set", () => {
  it("no query returns the full authorized list", () => {
    expect(filterAuthorizedClients(PORTFOLIO)).toHaveLength(2);
  });

  it("matches on org name (case-insensitive)", () => {
    const matched = filterAuthorizedClients(PORTFOLIO, "制造");
    expect(matched).toHaveLength(1);
    expect(matched[0]?.clientOrganizationId).toBe("org-client-active-2");
  });

  it("matches on org id (case-insensitive)", () => {
    const matched = filterAuthorizedClients(PORTFOLIO, "ACTIVE-1");
    expect(matched).toHaveLength(1);
    expect(matched[0]?.clientOrganizationId).toBe("org-client-active-1");
  });

  it("a query that matches no authorized client yields an empty list (never invents one)", () => {
    expect(filterAuthorizedClients(PORTFOLIO, "org-unassigned")).toHaveLength(0);
  });
});
