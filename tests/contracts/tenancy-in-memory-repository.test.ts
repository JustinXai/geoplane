/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/tenancy/in-memory-repository.ts
 *   (checkpoint B5), see that file's header for full provenance.
 * reconstruction_reason: no original tests for a `tenancyRepository`
 *   implementation were recoverable.
 * original_file_unavailable: true
 *
 * Checkpoint B5 - end-to-end test for
 * src/contracts/tenancy/in-memory-repository.ts. Deliberately a single
 * real scenario exercising B1 (entities) + B2 (authorization) + B3's
 * invariants (mirrored in-memory) + B4 (invitations/audit) composed through
 * one InMemoryTenancyRepository instance, not isolated per-method unit
 * tests.
 */
import { describe, expect, it } from "vitest";
import type { AuthorizationContext } from "../../src/contracts/tenancy/entities.js";
import { AuthorizationDeniedError } from "../../src/contracts/tenancy/authorization.js";
import { InMemoryTenancyRepository, MembershipConflictError } from "../../src/contracts/tenancy/in-memory-repository.js";

const NOW = new Date("2026-07-18T00:00:00.000Z");
const LATER = new Date("2026-07-18T00:05:00.000Z");

function platformAdminCtx(organizationId: string): AuthorizationContext {
  return {
    actorUserId: "user_platform_admin",
    actorRole: "PLATFORM_SUPER_ADMIN",
    organizationId,
    organizationType: "PLATFORM",
    activeProjectId: null,
    activeClientOrganizationId: null,
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: true,
    permissions: ["*"],
  };
}

function clientOwnerCtx(userId: string, activeClientOrganizationId: string): AuthorizationContext {
  return {
    actorUserId: userId,
    actorRole: "CLIENT_OWNER",
    organizationId: activeClientOrganizationId,
    organizationType: "CLIENT",
    activeProjectId: null,
    activeClientOrganizationId,
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: false,
    permissions: [],
  };
}

describe("tenancy in-memory repository B5 (end-to-end)", () => {
  it("composes B1-B4 through one repository: idempotent org creation, single-active-client-membership enforcement, invitation+audit composition, and authorization-gated listOrganizations", () => {
    const repo = new InMemoryTenancyRepository();
    const platformCreatorId = "user_platform_creator";

    // --- Organizations: a PLATFORM org and two CLIENT orgs -----------------
    const platformOrg = repo.createOrganization({
      type: "PLATFORM",
      displayName: "GeoPlane Platform",
      idempotencyKey: "idem-platform-1",
      createdByUserId: platformCreatorId,
      now: NOW,
    });

    const clientOrgA = repo.createOrganization({
      type: "CLIENT",
      displayName: "Client Org A",
      idempotencyKey: "idem-client-a",
      createdByUserId: platformCreatorId,
      now: NOW,
    });

    const clientOrgB = repo.createOrganization({
      type: "CLIENT",
      displayName: "Client Org B",
      idempotencyKey: "idem-client-b",
      createdByUserId: platformCreatorId,
      now: NOW,
    });

    // --- createOrganization idempotency (mirrors uq_organization_idempotency_key) ---
    const clientOrgADuplicateAttempt = repo.createOrganization({
      type: "CLIENT",
      displayName: "Client Org A (duplicate attempt, different display name)",
      idempotencyKey: "idem-client-a",
      createdByUserId: platformCreatorId,
      now: LATER,
    });
    expect(clientOrgADuplicateAttempt.id).toBe(clientOrgA.id);
    expect(clientOrgADuplicateAttempt.displayName).toBe(clientOrgA.displayName);
    // No duplicate row was created - the platform admin's full org list is still exactly 3.
    expect(repo.listOrganizations(platformAdminCtx(platformOrg.id)).map((o) => o.id).sort()).toEqual(
      [platformOrg.id, clientOrgA.id, clientOrgB.id].sort(),
    );

    // --- Membership: CLIENT_OWNER in Client Org A ---------------------------
    const clientOwnerUserId = "user_client_owner";
    const membershipA = repo.createMembership({
      userId: clientOwnerUserId,
      organizationId: clientOrgA.id,
      role: "CLIENT_OWNER",
      now: NOW,
    });
    expect(membershipA.status).toBe("ACTIVE");
    expect(membershipA.organizationId).toBe(clientOrgA.id);

    // --- Single-active-CLIENT-membership invariant (mirrors
    // uq_membership_one_active_client_org_per_user): a second ACTIVE
    // CLIENT-type membership for the SAME user in a DIFFERENT client org
    // must throw, not silently succeed or silently no-op. ---
    expect(() =>
      repo.createMembership({
        userId: clientOwnerUserId,
        organizationId: clientOrgB.id,
        role: "CLIENT_OWNER",
        now: NOW,
      }),
    ).toThrow(MembershipConflictError);

    try {
      repo.createMembership({
        userId: clientOwnerUserId,
        organizationId: clientOrgB.id,
        role: "CLIENT_OWNER",
        now: NOW,
      });
      throw new Error("expected createMembership to throw MembershipConflictError");
    } catch (err) {
      expect(err).toBeInstanceOf(MembershipConflictError);
      const conflict = err as MembershipConflictError;
      expect(conflict.userId).toBe(clientOwnerUserId);
      expect(conflict.existingClientOrganizationId).toBe(clientOrgA.id);
      expect(conflict.attemptedClientOrganizationId).toBe(clientOrgB.id);
    }

    // --- Invitation + audit composition (B4 issueInvitation/revokeInvitation
    // wired through B5, each call also appending a real audit.ts AuditEvent) ---
    const adminCtx = platformAdminCtx(platformOrg.id);

    const issued = repo.issueAndRecordInvitation({
      organizationId: clientOrgA.id,
      invitedEmail: "invitee@example.com",
      role: "CLIENT_OWNER",
      actor: adminCtx,
      now: NOW,
    });
    expect(issued.invitation.status).toBe("PENDING");
    expect(issued.invitation.tokenHash).toBeTruthy();
    // The raw token is never present on the persistable invitation record.
    expect("token" in issued.invitation).toBe(false);

    const revoked = repo.revokeAndRecordInvitation({
      invitationId: issued.invitation.id,
      actor: adminCtx,
      now: LATER,
    });
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedByUserId).toBe(adminCtx.actorUserId);

    const auditForOrgA = repo.listAudit(clientOrgA.id);
    expect(auditForOrgA).toHaveLength(2);
    expect(auditForOrgA[0]?.action).toBe("invitation.issue");
    expect(auditForOrgA[0]?.targetId).toBe(issued.invitation.id);
    expect(auditForOrgA[1]?.action).toBe("invitation.revoke");
    expect(auditForOrgA[1]?.targetId).toBe(issued.invitation.id);
    // Sorted by createdAt: issue happened at NOW, revoke at LATER.
    expect(auditForOrgA[0]!.createdAt <= auditForOrgA[1]!.createdAt).toBe(true);

    // --- Revoking as a non-admin actor is denied, and produces no audit event ---
    const secondInvitation = repo.issueAndRecordInvitation({
      organizationId: clientOrgA.id,
      invitedEmail: "invitee-2@example.com",
      role: "CLIENT_OWNER",
      actor: adminCtx,
      now: NOW,
    });
    const nonAdminCtx = clientOwnerCtx(clientOwnerUserId, clientOrgA.id);
    expect(() =>
      repo.revokeAndRecordInvitation({
        invitationId: secondInvitation.invitation.id,
        actor: nonAdminCtx,
        now: LATER,
      }),
    ).toThrow(AuthorizationDeniedError);

    // Denied revoke did not flip the invitation's status...
    expect(repo.getInvitation(secondInvitation.invitation.id)?.status).toBe("PENDING");
    // ...and did not append a spurious "we revoked it" audit event: only the
    // 2 events from the first invitation's issue+revoke, plus this second
    // invitation's issue event (3 total), never a revoke event for it.
    const auditForOrgAAfterDenial = repo.listAudit(clientOrgA.id);
    expect(auditForOrgAAfterDenial).toHaveLength(3);
    expect(auditForOrgAAfterDenial.filter((e) => e.action === "invitation.revoke")).toHaveLength(1);

    // --- listOrganizations: a CLIENT_OWNER's ctx never sees an org outside
    // their own, by actually calling authorization.ts's
    // canAccessClientOrganization (real B2 integration, not a
    // reimplementation of the rule). ---
    const visibleToClientOwner = repo.listOrganizations(nonAdminCtx);
    expect(visibleToClientOwner.map((o) => o.id)).toEqual([clientOrgA.id]);
    expect(visibleToClientOwner.some((o) => o.id === clientOrgB.id)).toBe(false);
    expect(visibleToClientOwner.some((o) => o.id === platformOrg.id)).toBe(false);

    // Platform admin still sees everything, including the PLATFORM org itself.
    const visibleToAdmin = repo.listOrganizations(adminCtx);
    expect(visibleToAdmin.map((o) => o.id).sort()).toEqual([platformOrg.id, clientOrgA.id, clientOrgB.id].sort());
  });
});
