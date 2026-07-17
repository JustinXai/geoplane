/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/tenancy/audit.ts (checkpoint B4),
 *   see that file's header for full provenance (incl. the recovered
 *   00040000000C9C6422CCAB4F-page.tsx corroboration for the audit field set).
 * reconstruction_reason: no original tests for audit-event recording/
 *   hashing logic were recoverable.
 * original_file_unavailable: true
 *
 * Checkpoint B4 - tests for src/contracts/tenancy/audit.ts.
 */
import { describe, expect, it } from "vitest";
import { computeAuditEventHash, recordAuditEvent } from "../../src/contracts/tenancy/audit.js";

const NOW = new Date("2026-07-18T00:00:00.000Z");

function baseInput() {
  return {
    organizationId: "org_agency_1",
    actorUserId: "user_2",
    actorOrganizationId: "org_agency_1",
    clientOrganizationId: "org_client_1",
    projectId: "proj_1",
    action: "invitation.revoke",
    targetType: "Invitation",
    targetId: "inv_1",
    metadata: { reason: "duplicate" },
    now: NOW,
  };
}

describe("tenancy audit B4", () => {
  it("records an AuditEvent with a populated eventHash and the expected pass-through fields", () => {
    const event = recordAuditEvent(baseInput());
    expect(event.eventHash).toBeTruthy();
    expect(event.action).toBe("invitation.revoke");
    expect(event.targetType).toBe("Invitation");
    expect(event.targetId).toBe("inv_1");
    expect(event.actorUserId).toBe("user_2");
    expect(event.createdAt).toBe(NOW.toISOString());
  });

  it("produces a stable hash for identical inputs", () => {
    const first = recordAuditEvent(baseInput());
    const second = recordAuditEvent(baseInput());
    expect(first.eventHash).toBe(second.eventHash);

    // Also true of the underlying hash function directly, given the exact
    // same documented input fields.
    const h1 = computeAuditEventHash({
      action: "invitation.revoke",
      targetType: "Invitation",
      targetId: "inv_1",
      actorUserId: "user_2",
      createdAt: NOW.toISOString(),
    });
    const h2 = computeAuditEventHash({
      action: "invitation.revoke",
      targetType: "Invitation",
      targetId: "inv_1",
      actorUserId: "user_2",
      createdAt: NOW.toISOString(),
    });
    expect(h1).toBe(h2);
  });

  it("produces a different hash when the action changes", () => {
    const original = recordAuditEvent(baseInput());
    const changed = recordAuditEvent({ ...baseInput(), action: "invitation.issue" });
    expect(changed.eventHash).not.toBe(original.eventHash);
  });

  it("produces a different hash when targetType changes", () => {
    const original = recordAuditEvent(baseInput());
    const changed = recordAuditEvent({ ...baseInput(), targetType: "Membership" });
    expect(changed.eventHash).not.toBe(original.eventHash);
  });

  it("produces a different hash when targetId changes", () => {
    const original = recordAuditEvent(baseInput());
    const changed = recordAuditEvent({ ...baseInput(), targetId: "inv_2" });
    expect(changed.eventHash).not.toBe(original.eventHash);
  });

  it("produces a different hash when actorUserId changes", () => {
    const original = recordAuditEvent(baseInput());
    const changed = recordAuditEvent({ ...baseInput(), actorUserId: "user_3" });
    expect(changed.eventHash).not.toBe(original.eventHash);
  });

  it("produces a different hash when createdAt (now) changes", () => {
    const original = recordAuditEvent(baseInput());
    const changed = recordAuditEvent({ ...baseInput(), now: new Date("2026-07-19T00:00:00.000Z") });
    expect(changed.eventHash).not.toBe(original.eventHash);
  });

  it("does NOT change the hash when metadata changes (metadata is not part of the documented hash input)", () => {
    const original = recordAuditEvent(baseInput());
    const changed = recordAuditEvent({ ...baseInput(), metadata: { reason: "something else entirely" } });
    expect(changed.eventHash).toBe(original.eventHash);
  });
});
