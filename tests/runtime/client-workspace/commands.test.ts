/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D — batch 2) — the client WRITE actions POST to the correct
 * command route with the right body, derive the actor server-side (never send a client-supplied
 * reviewer / actor / org id), and surface success / error(500) / forbidden(403) / validation(422)
 * as the same discriminated Result the read loaders use.
 */
import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "../../../src/lib/api-client/http.js";
import type { HumanReviewDecisionViewV1 } from "../../../src/runtime/commands/geo-dto.js";
import type { KnowledgePackageViewV1 } from "../../../src/runtime/api-contracts/index.js";
import {
  confirmKnowledgePackage,
  submitOpportunityReview,
} from "../../../src/components/client-runtime/commands.js";
import { fakeApiClient } from "./fake-api-client.js";

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VALIDATION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REVIEW_PATH = `/api/opportunities/${OPPORTUNITY_ID}/reviews`;

const REVIEW_OK: Result<HumanReviewDecisionViewV1> = ok({
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  clientOrganizationId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  projectId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  opportunityId: OPPORTUNITY_ID,
  opportunityValidationId: VALIDATION_ID,
  status: "APPROVED",
  reviewerId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  decidedAt: "2026-07-18T00:00:00.000Z",
});

// Keys the client must NEVER put in a write body — identity is always server-derived.
const ACTOR_KEYS = [
  "reviewerId",
  "reviewer",
  "reviewerUserId",
  "approverId",
  "actor",
  "actorId",
  "userId",
  "organizationId",
  "clientOrganizationId",
  "tenantId",
];

function assertNoActorInBody(body: unknown): void {
  expect(body === null || typeof body === "object").toBe(true);
  const obj = (body ?? {}) as Record<string, unknown>;
  for (const key of ACTOR_KEYS) {
    expect(Object.prototype.hasOwnProperty.call(obj, key), `body leaked actor key "${key}"`).toBe(
      false,
    );
  }
}

describe("submitOpportunityReview — POST /api/opportunities/[id]/reviews", () => {
  it("POSTs to the opportunity's reviews route with the decision (CONFIRMED sends no note)", async () => {
    const { client, calls } = fakeApiClient({ [REVIEW_PATH]: REVIEW_OK });

    const result = await submitOpportunityReview(
      { opportunityId: OPPORTUNITY_ID, opportunityValidationId: VALIDATION_ID, decision: "CONFIRMED" },
      client,
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("expected a recorded call");
    expect(call.path).toBe(REVIEW_PATH);
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ opportunityValidationId: VALIDATION_ID, decision: "CONFIRMED" });
    expect((call.body as Record<string, unknown>).note).toBeUndefined();
  });

  it("includes the note for a CHANGES_REQUESTED decision", async () => {
    const { client, calls } = fakeApiClient({ [REVIEW_PATH]: REVIEW_OK });

    await submitOpportunityReview(
      {
        opportunityId: OPPORTUNITY_ID,
        opportunityValidationId: VALIDATION_ID,
        decision: "CHANGES_REQUESTED",
        note: "请补充数据来源",
      },
      client,
    );

    expect(calls[0]?.body).toEqual({
      opportunityValidationId: VALIDATION_ID,
      decision: "CHANGES_REQUESTED",
      note: "请补充数据来源",
    });
  });

  it("never sends a client-supplied reviewer / actor / org id (identity is server-derived)", async () => {
    const { client, calls } = fakeApiClient({ [REVIEW_PATH]: REVIEW_OK });

    await submitOpportunityReview(
      { opportunityId: OPPORTUNITY_ID, opportunityValidationId: VALIDATION_ID, decision: "REJECTED", note: "不符合方向" },
      client,
    );

    assertNoActorInBody(calls[0]?.body);
    // Only the subject reference, the decision and the note may travel in the body.
    expect(Object.keys((calls[0]?.body ?? {}) as Record<string, unknown>).sort()).toEqual(
      ["decision", "note", "opportunityValidationId"],
    );
  });

  it("encodes the opportunity id into the path segment", async () => {
    const { client, calls } = fakeApiClient();
    await submitOpportunityReview(
      { opportunityId: "opp 1", opportunityValidationId: VALIDATION_ID, decision: "CONFIRMED" },
      client,
    );
    expect(calls[0]?.path).toBe("/api/opportunities/opp%201/reviews");
  });

  it("returns the error variant for a 500 (INTERNAL_ERROR) without throwing", async () => {
    const { client } = fakeApiClient({ [REVIEW_PATH]: err("INTERNAL_ERROR", "boom") });
    const result = await submitOpportunityReview(
      { opportunityId: OPPORTUNITY_ID, opportunityValidationId: VALIDATION_ID, decision: "CONFIRMED" },
      client,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INTERNAL_ERROR");
  });

  it("returns the forbidden variant for a 403 (FORBIDDEN)", async () => {
    const { client } = fakeApiClient({ [REVIEW_PATH]: err("FORBIDDEN", "denied") });
    const result = await submitOpportunityReview(
      { opportunityId: OPPORTUNITY_ID, opportunityValidationId: VALIDATION_ID, decision: "CONFIRMED" },
      client,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("returns the validation variant for a 422 (VALIDATION_FAILED)", async () => {
    const { client } = fakeApiClient({
      [REVIEW_PATH]: err("VALIDATION_FAILED", "a note is required for a CHANGES_REQUESTED decision."),
    });
    const result = await submitOpportunityReview(
      { opportunityId: OPPORTUNITY_ID, opportunityValidationId: VALIDATION_ID, decision: "CHANGES_REQUESTED" },
      client,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_FAILED");
  });
});

describe("confirmKnowledgePackage — POST /api/knowledge/packages/[id]/confirm", () => {
  const PACKAGE_ID = "11112222-3333-4444-5555-666677778888";
  const CONFIRM_PATH = `/api/knowledge/packages/${PACKAGE_ID}/confirm`;
  const PACKAGE_OK: Result<KnowledgePackageViewV1> = ok({
    id: PACKAGE_ID,
    projectId: "99990000-1111-2222-3333-444455556666",
    title: "产品功能总览",
    status: "CONFIRMED",
    documentCount: 3,
    openIssueCount: 0,
    updatedAt: "2026-07-18T00:00:00.000Z",
    confirmedAt: "2026-07-18T00:00:00.000Z",
  });

  it("POSTs to the package's confirm route with NO body (confirmer is server-derived)", async () => {
    const { client, calls } = fakeApiClient({ [CONFIRM_PATH]: PACKAGE_OK });

    const result = await confirmKnowledgePackage(PACKAGE_ID, client);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(CONFIRM_PATH);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBeUndefined();
  });

  it("encodes the package id and returns the refreshed package on success", async () => {
    const { client, calls } = fakeApiClient({
      [`/api/knowledge/packages/kp%201/confirm`]: PACKAGE_OK,
    });
    const result = await confirmKnowledgePackage("kp 1", client);
    expect(calls[0]?.path).toBe("/api/knowledge/packages/kp%201/confirm");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("CONFIRMED");
  });

  it("surfaces forbidden (403) and error (500) as Result variants without throwing", async () => {
    const forbidden = await confirmKnowledgePackage(
      PACKAGE_ID,
      fakeApiClient({ [CONFIRM_PATH]: err("FORBIDDEN", "denied") }).client,
    );
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.code).toBe("FORBIDDEN");

    const errored = await confirmKnowledgePackage(
      PACKAGE_ID,
      fakeApiClient({ [CONFIRM_PATH]: err("INTERNAL_ERROR", "boom") }).client,
    );
    expect(errored.ok).toBe(false);
    if (!errored.ok) expect(errored.code).toBe("INTERNAL_ERROR");
  });
});
