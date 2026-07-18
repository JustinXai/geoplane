/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — OPS organizations screen: single read model, distinct
 * client-vs-project counts, five async states, non-platform -> forbidden. Pure-function tests over a
 * fake ApiClient (no DOM / jsdom), mirroring batch 1. Relative .js imports; no `@/` in tests.
 */
import { describe, expect, it } from "vitest";
import { selectAsyncState } from "../../../src/components/runtime/async-state.js";
import {
  deriveOrganizationKpis,
  filterOrganizations,
  isOpsOrganizationsEmpty,
  loadOpsOrganizations,
  organizationStatusLabel,
  organizationTypeLabel,
  type OpsOrganizationsReadModel,
  type OrganizationSummaryV1,
} from "../../../src/components/ops-runtime/index.js";
import type { ProjectViewV1 } from "../../../src/runtime/api-contracts/index.js";
import { makeFakeApiClient } from "./fake-api-client.js";

// GET /api/ops/organizations returns EVERY organization across all three types. Distinct type mix so
// clientCount (3 CLIENT) is a different number from both totalOrganizations (6) and projectCount (2).
const ORGANIZATIONS: readonly OrganizationSummaryV1[] = [
  { id: "org-platform-1", type: "PLATFORM", displayName: "示例平台运营方", status: "ACTIVE", createdAt: "2026-01-05T00:00:00.000Z" },
  { id: "org-agency-1", type: "AGENCY", displayName: "示例代理商甲", status: "ACTIVE", createdAt: "2026-02-10T00:00:00.000Z" },
  { id: "org-agency-2", type: "AGENCY", displayName: "示例代理商乙", status: "ACTIVE", createdAt: "2026-03-02T00:00:00.000Z" },
  { id: "org-client-1", type: "CLIENT", displayName: "示例客户企业", status: "ACTIVE", createdAt: "2026-02-18T00:00:00.000Z" },
  { id: "org-client-2", type: "CLIENT", displayName: "示例制造企业", status: "ACTIVE", createdAt: "2026-03-20T00:00:00.000Z" },
  { id: "org-client-3", type: "CLIENT", displayName: "示例零售企业", status: "SUSPENDED", createdAt: "2026-01-30T00:00:00.000Z" },
];

const PROJECTS: readonly ProjectViewV1[] = [
  { id: "PRJ-1", name: "项目一", clientOrganizationId: "org-client-1", clientOrganizationName: "示例客户企业", createdAt: "2026-07-01" },
  { id: "PRJ-2", name: "项目二", clientOrganizationId: "org-client-2", clientOrganizationName: "示例制造企业", createdAt: "2026-07-02" },
];

function okRoutes() {
  return {
    "GET /api/ops/organizations": { ok: true as const, data: ORGANIZATIONS },
    "GET /api/projects": { ok: true as const, data: PROJECTS },
  };
}

describe("loadOpsOrganizations — endpoints + single read model", () => {
  it("issues GET /api/ops/organizations then GET /api/projects and returns ONE read model", async () => {
    const { client, calls } = makeFakeApiClient(okRoutes());
    const result = await loadOpsOrganizations(client);

    expect(result.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/ops/organizations",
      "GET /api/projects",
    ]);
    if (result.ok) {
      // Both collections live on the SAME model object the KPI tiles and the list read from.
      expect(result.data.organizations).toHaveLength(6);
      expect(result.data.projects).toHaveLength(2);
    }
  });

  it("KPI tiles and list derive from the SAME model — client count and project count are DISTINCT", async () => {
    const { client } = makeFakeApiClient(okRoutes());
    const result = await loadOpsOrganizations(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const model = result.data;
    const kpis = deriveOrganizationKpis(model);

    expect(kpis.totalOrganizations).toBe(6);
    expect(kpis.platformCount).toBe(1);
    expect(kpis.agencyCount).toBe(2);
    expect(kpis.clientCount).toBe(3);
    expect(kpis.projectCount).toBe(2);

    // The two counts are NOT conflated: client count comes from CLIENT orgs, project count from
    // the projects collection — different sources, different numbers.
    expect(kpis.clientCount).not.toBe(kpis.projectCount);
    expect(kpis.clientCount).toBe(model.organizations.filter((o) => o.type === "CLIENT").length);
    expect(kpis.projectCount).toBe(model.projects.length);

    // The list the screen renders comes from the same model — its client rows match clientCount.
    const listClientCount = filterOrganizations(model).filter((o) => o.type === "CLIENT").length;
    expect(listClientCount).toBe(kpis.clientCount);
  });

  it("fail-closed: a non-platform caller -> FORBIDDEN, and GET /api/projects is NOT called", async () => {
    const { client, calls } = makeFakeApiClient({
      "GET /api/ops/organizations": {
        ok: false,
        code: "FORBIDDEN",
        message: "Only a platform super admin may list organizations.",
      },
    });
    const result = await loadOpsOrganizations(client);

    expect(result.ok).toBe(false);
    expect(selectAsyncState({ result }).status).toBe("forbidden");
    // Short-circuits on the first failure — no second request leaks out.
    expect(calls.map((c) => c.path)).toEqual(["/api/ops/organizations"]);
  });

  it("propagates a projects failure (fail-closed), never a partial success", async () => {
    const { client } = makeFakeApiClient({
      "GET /api/ops/organizations": { ok: true, data: ORGANIZATIONS },
      "GET /api/projects": { ok: false, code: "INTERNAL_ERROR", message: "boom" },
    });
    const result = await loadOpsOrganizations(client);
    expect(result.ok).toBe(false);
    expect(selectAsyncState({ result }).status).toBe("error");
  });
});

describe("five async UI states — organizations screen", () => {
  it("Loading: no result yet", () => {
    expect(selectAsyncState<OpsOrganizationsReadModel>({ result: undefined }).status).toBe("loading");
  });

  it("Success: a populated directory", () => {
    const result = { ok: true as const, data: { organizations: ORGANIZATIONS, projects: PROJECTS } };
    expect(selectAsyncState({ result, isEmpty: isOpsOrganizationsEmpty }).status).toBe("success");
  });

  it("Empty: no organizations at all", () => {
    const result = { ok: true as const, data: { organizations: [], projects: [] } };
    expect(selectAsyncState({ result, isEmpty: isOpsOrganizationsEmpty }).status).toBe("empty");
    expect(isOpsOrganizationsEmpty(result.data)).toBe(true);
  });

  it("Forbidden: UNAUTHENTICATED and FORBIDDEN both map to forbidden", () => {
    for (const code of ["UNAUTHENTICATED", "FORBIDDEN"] as const) {
      const result = { ok: false as const, code, message: code };
      expect(selectAsyncState<OpsOrganizationsReadModel>({ result }).status).toBe("forbidden");
    }
  });

  it("Error: a non-authorization failure maps to error", () => {
    const result = { ok: false as const, code: "INTERNAL_ERROR" as const, message: "boom" };
    expect(selectAsyncState<OpsOrganizationsReadModel>({ result }).status).toBe("error");
  });
});

describe("organization search + labels", () => {
  const MODEL: OpsOrganizationsReadModel = { organizations: ORGANIZATIONS, projects: PROJECTS };

  it("no query returns the full directory", () => {
    expect(filterOrganizations(MODEL)).toHaveLength(6);
  });

  it("matches on display name (case-insensitive) and only narrows", () => {
    const matched = filterOrganizations(MODEL, "制造");
    expect(matched).toHaveLength(1);
    expect(matched[0]?.id).toBe("org-client-2");
  });

  it("matches on id (case-insensitive) and on type", () => {
    // ids are org-<type>-N; a case-insensitive id substring still narrows to the matching rows.
    expect(filterOrganizations(MODEL, "ORG-AGENCY")).toHaveLength(2);
    expect(filterOrganizations(MODEL, "org-client-2")).toHaveLength(1);
    // "platform" matches the PLATFORM type (and that org's id) — one row.
    expect(filterOrganizations(MODEL, "platform")).toHaveLength(1);
    // A query matching no id / name / type yields nothing (never invents a row).
    expect(filterOrganizations(MODEL, "no-such-token")).toHaveLength(0);
  });

  it("maps type and status to human labels", () => {
    expect(organizationTypeLabel("PLATFORM")).toBe("平台");
    expect(organizationTypeLabel("AGENCY")).toBe("代理商");
    expect(organizationTypeLabel("CLIENT")).toBe("客户");
    expect(organizationStatusLabel("ACTIVE")).toBe("已启用");
    expect(organizationStatusLabel("SUSPENDED")).toBe("已停用");
    expect(organizationStatusLabel("ARCHIVED")).toBe("已归档");
  });
});
