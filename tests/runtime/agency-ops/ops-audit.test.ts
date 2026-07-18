/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — OPS audit surfaces: loads GET /api/ops/audit, maps
 * AuditEventViewV1, narrows the trail by action for the assignment/invitation screens, five async
 * states, non-platform -> forbidden. Pure-function tests over a fake ApiClient (no DOM / jsdom).
 * Relative .js imports; no `@/` in tests.
 */
import { describe, expect, it } from "vitest";
import { selectAsyncState } from "../../../src/components/runtime/async-state.js";
import {
  OPS_ASSIGNMENT_ACTIONS,
  OPS_INVITATION_ACTIONS,
  filterAuditByActions,
  isAuditEmpty,
  listOpsAudit,
  toOpsAuditRow,
} from "../../../src/components/ops-runtime/index.js";
import type { AuditEventViewV1 } from "../../../src/runtime/api-contracts/index.js";
import { makeFakeApiClient } from "./fake-api-client.js";

const EVENTS: readonly AuditEventViewV1[] = [
  {
    id: "AUD-1",
    action: "ops.assignment.create",
    actorDisplayName: "admin@example.com",
    clientOrganizationId: "org-client-2",
    projectId: null,
    targetType: "agency_client_assignment",
    occurredAt: "2026-07-17T10:02:00.000Z",
  },
  {
    id: "AUD-2",
    action: "project.invitation.create",
    actorDisplayName: "admin@example.com",
    clientOrganizationId: null,
    projectId: "PRJ-1",
    targetType: "invitation",
    occurredAt: "2026-07-17T11:47:00.000Z",
  },
  {
    id: "AUD-3",
    action: "account.login",
    actorDisplayName: null,
    clientOrganizationId: null,
    projectId: null,
    targetType: null,
    occurredAt: "2026-07-18T08:30:00.000Z",
  },
];

describe("listOpsAudit — endpoint", () => {
  it("issues GET /api/ops/audit once (no limit)", async () => {
    const { client, calls } = makeFakeApiClient({
      "GET /api/ops/audit": { ok: true, data: EVENTS },
    });
    const result = await listOpsAudit({}, client);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/ops/audit");
    expect(calls[0]?.method).toBe("GET");
  });

  it("passes a ?limit query when provided", async () => {
    const { client, calls } = makeFakeApiClient({
      "GET /api/ops/audit?limit=200": { ok: true, data: EVENTS },
    });
    const result = await listOpsAudit({ limit: 200 }, client);

    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe("/api/ops/audit?limit=200");
  });

  it("a non-platform caller surfaces FORBIDDEN (forbidden state, never the trail)", async () => {
    const { client } = makeFakeApiClient({
      "GET /api/ops/audit": {
        ok: false,
        code: "FORBIDDEN",
        message: "Only a platform super admin may read the audit trail.",
      },
    });
    const result = await listOpsAudit({}, client);
    expect(selectAsyncState({ result }).status).toBe("forbidden");
  });
});

describe("toOpsAuditRow — maps real actor / action / target / timestamp", () => {
  it("maps an event with a resolved actor and a composed target", () => {
    const first = EVENTS[0];
    expect(first).toBeDefined();
    if (!first) return;
    const row = toOpsAuditRow(first);
    expect(row.id).toBe("AUD-1");
    expect(row.action).toBe("ops.assignment.create");
    expect(row.actorLabel).toBe("admin@example.com");
    expect(row.occurredAt).toBe("2026-07-17T10:02:00.000Z");
    // Target composes the real target type + client org id the event carries.
    expect(row.targetLabel).toContain("agency_client_assignment");
    expect(row.targetLabel).toContain("org-client-2");
  });

  it("falls back to a stable placeholder when the actor and target are unresolved", () => {
    const third = EVENTS[2];
    expect(third).toBeDefined();
    if (!third) return;
    const row = toOpsAuditRow(third);
    expect(row.actorLabel).toBe("系统");
    expect(row.targetLabel).toBe("—");
  });
});

describe("filterAuditByActions — assignment/invitation screens narrow the shared trail", () => {
  it("assignment screen sees ONLY assignment-action events", () => {
    const rows = filterAuditByActions(EVENTS, OPS_ASSIGNMENT_ACTIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("AUD-1");
  });

  it("invitation screen sees ONLY invitation-action events", () => {
    const rows = filterAuditByActions(EVENTS, OPS_INVITATION_ACTIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("AUD-2");
  });

  it("filtering only ever narrows — it never invents an unrelated row", () => {
    const rows = filterAuditByActions(EVENTS, ["no.such.action"]);
    expect(rows).toHaveLength(0);
  });
});

describe("five async UI states — audit screens", () => {
  it("Loading / Success / Empty via isAuditEmpty", () => {
    expect(selectAsyncState<readonly AuditEventViewV1[]>({ result: undefined }).status).toBe("loading");

    const success = { ok: true as const, data: EVENTS };
    expect(selectAsyncState({ result: success, isEmpty: isAuditEmpty }).status).toBe("success");

    const empty = { ok: true as const, data: [] as readonly AuditEventViewV1[] };
    expect(selectAsyncState({ result: empty, isEmpty: isAuditEmpty }).status).toBe("empty");
    expect(isAuditEmpty([])).toBe(true);
  });

  it("assignment screen Empty when no assignment events exist (post-filter emptiness)", () => {
    const onlyLogin: readonly AuditEventViewV1[] = [EVENTS[2] as AuditEventViewV1];
    const result = { ok: true as const, data: onlyLogin };
    const isEmpty = (events: readonly AuditEventViewV1[]) =>
      filterAuditByActions(events, OPS_ASSIGNMENT_ACTIONS).length === 0;
    expect(selectAsyncState({ result, isEmpty }).status).toBe("empty");
  });

  it("Forbidden and Error map distinctly", () => {
    const forbidden = { ok: false as const, code: "UNAUTHENTICATED" as const, message: "x" };
    expect(selectAsyncState<readonly AuditEventViewV1[]>({ result: forbidden }).status).toBe("forbidden");

    const error = { ok: false as const, code: "INTERNAL_ERROR" as const, message: "x" };
    expect(selectAsyncState<readonly AuditEventViewV1[]>({ result: error }).status).toBe("error");
  });
});
