/**
 * CLIENT_REVIEW_RUNTIME_V1 (Agent C2) — the client review control + command wrapper map the three
 * Chinese decision labels (确认 / 要求修改 / 暂不处理) to the three frozen decisions
 * (CONFIRMED / CHANGES_REQUESTED / DEFERRED), and the wrapper posts the OPAQUE reviewReferenceCode
 * (never a raw UUID) plus the version — identity stays server-derived.
 *
 * No DOM renderer is used (vitest node env): the control's decision mapping is exposed as pure
 * constants and asserted directly, mirroring how the other client-workspace suites test logic.
 */
import { describe, expect, it } from "vitest";
import { ok, type Result } from "../../../src/lib/api-client/http.js";
import type { HumanReviewDecisionViewV1 } from "../../../src/runtime/commands/geo-dto.js";
import type { ClientReviewDecisionValue } from "../../../src/contracts/tenancy/entities.js";
import {
  DECISION_LABELS,
  DECISION_ORDER,
} from "../../../src/components/client-runtime/OpportunityReviewControl.js";
import { submitOpportunityReview } from "../../../src/components/client-runtime/commands.js";
import { fakeApiClient } from "../client-workspace/fake-api-client.js";

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VALIDATION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REVIEW_CODE = "b3BhcXVlLWNvZGU.deadbeefsignature";
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

describe("OpportunityReviewControl — decision mapping", () => {
  it("maps 确认 / 要求修改 / 暂不处理 to CONFIRMED / CHANGES_REQUESTED / DEFERRED", () => {
    expect(DECISION_LABELS.CONFIRMED).toBe("确认");
    expect(DECISION_LABELS.CHANGES_REQUESTED).toBe("要求修改");
    expect(DECISION_LABELS.DEFERRED).toBe("暂不处理");
  });

  it("offers exactly the three frozen client decisions, in a stable order", () => {
    const expected: readonly ClientReviewDecisionValue[] = [
      "CONFIRMED",
      "CHANGES_REQUESTED",
      "DEFERRED",
    ];
    expect(DECISION_ORDER).toEqual(expected);
    // Every offered decision has a label; the label map has no extra (e.g. REJECTED) keys.
    expect(Object.keys(DECISION_LABELS).sort()).toEqual([...expected].sort());
  });
});

describe("submitOpportunityReview — passes the opaque ref, never a UUID", () => {
  it("posts reviewReferenceCode + reviewVersion + decision; body carries no raw UUID", async () => {
    const { client, calls } = fakeApiClient({ [REVIEW_PATH]: REVIEW_OK });

    for (const decision of DECISION_ORDER) {
      await submitOpportunityReview(
        {
          opportunityId: OPPORTUNITY_ID,
          reviewReferenceCode: REVIEW_CODE,
          reviewVersion: 0,
          decision,
          ...(decision === "CONFIRMED" ? {} : { note: "备注" }),
        },
        client,
      );
    }

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      const body = (call.body ?? {}) as Record<string, unknown>;
      expect(body.reviewReferenceCode).toBe(REVIEW_CODE);
      expect(body.reviewVersion).toBe(0);
      expect(body).not.toHaveProperty("opportunityValidationId");
      expect(JSON.stringify(body)).not.toContain(VALIDATION_ID);
    }
    expect(calls.map((c) => (c.body as Record<string, unknown>).decision)).toEqual([
      "CONFIRMED",
      "CHANGES_REQUESTED",
      "DEFERRED",
    ]);
  });
});
