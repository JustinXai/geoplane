/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — acting-for-client context + the persistent banner,
 * and the NO-IMPERSONATION invariant. Pure-function tests over a fake ApiClient.
 */
import { describe, expect, it } from "vitest";
import { selectAsyncState } from "../../../src/components/runtime/async-state.js";
import {
  type AgencyActingContextV1,
  setAgencyContext,
} from "../../../src/components/agency-runtime/agency-api.js";
import {
  selectActingBanner,
  toActingBannerView,
} from "../../../src/components/agency-runtime/acting-context.js";
import { makeFakeApiClient } from "./fake-api-client.js";

const CONTEXT: AgencyActingContextV1 = {
  agencyOrganizationId: "org-agency-1",
  agencyOrganizationName: "示例代理商",
  actingClientOrganizationId: "org-client-active-1",
  actingClientOrganizationName: "示例客户企业",
  surface: "agency",
};

describe("setAgencyContext — endpoint", () => {
  it("POSTs /api/agency/context with the selected clientOrganizationId in the body", async () => {
    const { client, calls } = makeFakeApiClient({
      "POST /api/agency/context": { ok: true, data: CONTEXT },
    });
    const result = await setAgencyContext("org-client-active-1", client);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/agency/context");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ clientOrganizationId: "org-client-active-1" });
  });
});

describe("acting banner — visible only for a successful context", () => {
  it("a successful context shows the banner", () => {
    const state = selectActingBanner({ ok: true, data: CONTEXT });
    expect(state.visible).toBe(true);
  });

  it("no selection yet (undefined) shows no banner", () => {
    expect(selectActingBanner(undefined).visible).toBe(false);
  });

  it("a FORBIDDEN (unauthorized) selection shows no banner and is the forbidden state", () => {
    const result = {
      ok: false as const,
      code: "FORBIDDEN" as const,
      message: "Agency is not assigned to this client organization.",
    };
    expect(selectActingBanner(result).visible).toBe(false);
    expect(selectAsyncState({ result }).status).toBe("forbidden");
  });
});

describe("no impersonation — the actor stays the agency, never the client", () => {
  it("the banner view keeps agency (actor) and client (subject) distinct", () => {
    const view = toActingBannerView(CONTEXT);
    expect(view.actorIsAgency).toBe(true);
    expect(view.surface).toBe("agency");
    // The real actor is the AGENCY org, not the client org.
    expect(view.actorOrganizationId).toBe("org-agency-1");
    expect(view.actorOrganizationName).toBe("示例代理商");
    // The acted-for client is carried in a SEPARATE field and never overwrites the actor.
    expect(view.actingForClientOrganizationId).toBe("org-client-active-1");
    expect(view.actorOrganizationId).not.toBe(view.actingForClientOrganizationId);
    expect(view.actorOrganizationName).not.toBe(view.actingForClientOrganizationName);
  });

  it("a self-referential context (agency id === client id) is rejected as an impersonation defect", () => {
    const impersonating: AgencyActingContextV1 = {
      ...CONTEXT,
      actingClientOrganizationId: CONTEXT.agencyOrganizationId,
      actingClientOrganizationName: CONTEXT.agencyOrganizationName,
    };
    expect(() => toActingBannerView(impersonating)).toThrow(/impersonation/i);
  });

  it("an unauthorized selection returns FORBIDDEN from the server and sets no context", async () => {
    const { client } = makeFakeApiClient({
      "POST /api/agency/context": {
        ok: false,
        code: "FORBIDDEN",
        message: "Agency is not assigned to this client organization.",
      },
    });
    const result = await setAgencyContext("org-unassigned", client);
    expect(result.ok).toBe(false);
    expect(selectActingBanner(result).visible).toBe(false);
  });
});
