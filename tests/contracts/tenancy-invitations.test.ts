/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/tenancy/invitations.ts (checkpoint
 *   B4), see that file's header for full provenance (incl. the recovered
 *   00040000000C9C455B787075-route.ts corroboration for revokeInvitation).
 * reconstruction_reason: no original tests for invitation issuance/
 *   revocation/expiry logic were recoverable.
 * original_file_unavailable: true
 *
 * Checkpoint B4 - tests for src/contracts/tenancy/invitations.ts. Exercises
 * real issue/revoke/expiry behavior, not just type shapes.
 */
import { describe, expect, it } from "vitest";
import type { AuthorizationContext, Invitation } from "../../src/contracts/tenancy/entities.js";
import { AuthorizationDeniedError } from "../../src/contracts/tenancy/authorization.js";
import {
  effectiveInvitationStatus,
  hashInvitationToken,
  isInvitationUsable,
  issueInvitation,
  revokeInvitation,
} from "../../src/contracts/tenancy/invitations.js";

function platformAdminCtx(): AuthorizationContext {
  return {
    actorUserId: "user_platform_admin",
    actorRole: "PLATFORM_SUPER_ADMIN",
    organizationId: "org_platform",
    organizationType: "PLATFORM",
    activeProjectId: null,
    activeClientOrganizationId: null,
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: true,
    permissions: ["*"],
  };
}

function clientOwnerCtx(organizationId: string): AuthorizationContext {
  return {
    actorUserId: "user_client_owner",
    actorRole: "CLIENT_OWNER",
    organizationId,
    organizationType: "CLIENT",
    activeProjectId: null,
    activeClientOrganizationId: organizationId,
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: false,
    permissions: [],
  };
}

const NOW = new Date("2026-07-18T00:00:00.000Z");

describe("tenancy invitations B4", () => {
  it("issues a PENDING invitation whose record carries only a tokenHash, never a raw-token-looking value", () => {
    const { invitation, token } = issueInvitation({
      organizationId: "org_client_a",
      invitedEmail: "invitee@example-client.test",
      role: "CLIENT_OWNER",
      createdByUserId: "user_creator",
      now: NOW,
    });

    expect(invitation.status).toBe("PENDING");
    expect(invitation.tokenHash).toBe(hashInvitationToken(token));

    // The persisted/loggable record must never contain the raw token under
    // any field name or as a substring of any field value.
    const serializedRecord = JSON.stringify(invitation);
    expect(serializedRecord).not.toContain(token);
    expect(Object.keys(invitation)).not.toContain("token");
    expect(Object.keys(invitation)).not.toContain("rawToken");

    // The hash must not simply equal (or contain) the raw token either.
    expect(invitation.tokenHash).not.toBe(token);
    expect(invitation.tokenHash).not.toContain(token);
  });

  it("issued tokens are unique across calls (not deterministic/reused)", () => {
    const first = issueInvitation({
      organizationId: "org_client_a",
      invitedEmail: "a@example-client.test",
      role: "CLIENT_OWNER",
      createdByUserId: "user_creator",
      now: NOW,
    });
    const second = issueInvitation({
      organizationId: "org_client_a",
      invitedEmail: "b@example-client.test",
      role: "CLIENT_OWNER",
      createdByUserId: "user_creator",
      now: NOW,
    });
    expect(first.token).not.toBe(second.token);
    expect(first.invitation.tokenHash).not.toBe(second.invitation.tokenHash);
  });

  it("revoke succeeds for an ops-authorized (platform admin) actor", () => {
    const { invitation } = issueInvitation({
      organizationId: "org_client_a",
      invitedEmail: "invitee@example-client.test",
      role: "CLIENT_OWNER",
      createdByUserId: "user_creator",
      now: NOW,
    });

    const revoked = revokeInvitation(invitation, {
      invitationId: invitation.id,
      actor: platformAdminCtx(),
      now: NOW,
    });

    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedAt).toBe(NOW.toISOString());
    expect(revoked.revokedByUserId).toBe("user_platform_admin");
  });

  it("revoke is denied for a non-ops-authorized actor (e.g. a CLIENT_OWNER, even for their own organization)", () => {
    const { invitation } = issueInvitation({
      organizationId: "org_client_a",
      invitedEmail: "invitee@example-client.test",
      role: "CLIENT_OWNER",
      createdByUserId: "user_creator",
      now: NOW,
    });

    const nonOpsActor = clientOwnerCtx("org_client_a");

    expect(() =>
      revokeInvitation(invitation, {
        invitationId: invitation.id,
        actor: nonOpsActor,
        now: NOW,
      }),
    ).toThrow(AuthorizationDeniedError);

    // The invitation itself must be unchanged by the denied attempt.
    expect(invitation.status).toBe("PENDING");
    expect(invitation.revokedAt).toBeNull();
  });

  it("revoke rejects a mismatched invitationId defensively", () => {
    const { invitation } = issueInvitation({
      organizationId: "org_client_a",
      invitedEmail: "invitee@example-client.test",
      role: "CLIENT_OWNER",
      createdByUserId: "user_creator",
      now: NOW,
    });

    expect(() =>
      revokeInvitation(invitation, {
        invitationId: "some_other_invitation_id",
        actor: platformAdminCtx(),
        now: NOW,
      }),
    ).toThrow(/does not match/);
  });

  it("an expired-but-still-PENDING-status invitation is correctly treated as unusable", () => {
    const staleInvitation: Invitation = {
      id: "inv_stale",
      organizationId: "org_client_a",
      invitedEmail: "invitee@example-client.test",
      role: "CLIENT_OWNER",
      // Background job has NOT run yet - status column still says PENDING.
      status: "PENDING",
      tokenHash: "deadbeefdeadbeef",
      createdByUserId: "user_creator",
      createdAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-07-08T00:00:00.000Z", // in the past relative to NOW
      revokedAt: null,
      revokedByUserId: null,
    };

    expect(effectiveInvitationStatus(staleInvitation, NOW)).toBe("EXPIRED");
    expect(isInvitationUsable(staleInvitation, NOW)).toBe(false);
  });

  it("a genuinely PENDING, not-yet-expired invitation is usable", () => {
    const { invitation } = issueInvitation({
      organizationId: "org_client_a",
      invitedEmail: "invitee@example-client.test",
      role: "CLIENT_OWNER",
      createdByUserId: "user_creator",
      now: NOW,
    });
    expect(isInvitationUsable(invitation, NOW)).toBe(true);
    expect(effectiveInvitationStatus(invitation, NOW)).toBe("PENDING");
  });

  it("a REVOKED invitation is unusable regardless of expiresAt", () => {
    const revoked: Invitation = {
      id: "inv_revoked",
      organizationId: "org_client_a",
      invitedEmail: "invitee@example-client.test",
      role: "CLIENT_OWNER",
      status: "REVOKED",
      tokenHash: "deadbeefdeadbeef",
      createdByUserId: "user_creator",
      createdAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z", // not yet expired
      revokedAt: "2026-07-02T00:00:00.000Z",
      revokedByUserId: "user_platform_admin",
    };
    expect(isInvitationUsable(revoked, NOW)).toBe(false);
    expect(effectiveInvitationStatus(revoked, NOW)).toBe("REVOKED");
  });
});
