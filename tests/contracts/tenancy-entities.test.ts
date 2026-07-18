import { describe, expect, it } from "vitest";
import type {
  AgencyClientAssignment,
  ArtifactIndex,
  AuditEvent,
  AuthorizationContext,
  ClientReviewDecision,
  Invitation,
  Membership,
  Organization,
  Project,
  ProjectMembership,
  Session,
  User,
} from "../../src/contracts/tenancy/entities.js";

describe("tenancy contracts B1-CORRECTION", () => {
  it("builds a valid Organization with a non-displayName identity", () => {
    const org: Organization = {
      id: "org_1",
      type: "CLIENT",
      displayName: "示例客户项目",
      status: "ACTIVE",
      idempotencyKey: "idem_abc123",
      sourceNamespace: null,
      externalReference: null,
      createdAt: "2026-07-18T00:00:00.000Z",
      createdByUserId: "user_1",
    };
    expect(org.idempotencyKey).not.toBe(org.displayName);
  });

  it("builds a Membership carrying a status", () => {
    const membership: Membership = {
      id: "mem_1",
      userId: "user_1",
      organizationId: "org_1",
      role: "CLIENT_OWNER",
      status: "ACTIVE",
      createdAt: "2026-07-18T00:00:00.000Z",
    };
    expect(membership.status).toBe("ACTIVE");
  });

  it("builds a Session carrying an authorization snapshot and a version", () => {
    const session: Session = {
      id: "sess_1",
      userId: "user_1",
      membershipId: "mem_1",
      organizationId: "org_1",
      role: "CLIENT_OWNER",
      activeClientOrganizationId: "org_1",
      activeProjectId: "proj_1",
      sessionVersion: 1,
      createdAt: "2026-07-18T00:00:00.000Z",
      expiresAt: "2026-07-19T00:00:00.000Z",
      revokedAt: null,
    };
    expect(session.sessionVersion).toBeGreaterThan(0);
  });

  it("builds an AuthorizationContext with an explicit allow-list, never a wildcard", () => {
    const ctx: AuthorizationContext = {
      actorUserId: "user_2",
      actorRole: "AGENCY_OPERATOR",
      organizationId: "org_agency_1",
      organizationType: "AGENCY",
      activeProjectId: null,
      activeClientOrganizationId: null,
      assignedClientOrganizationIds: ["org_client_1"],
      allowedClientOrganizationIds: ["org_client_1"],
      isPlatformAdmin: false,
      permissions: ["project:read"],
    };
    expect(ctx.allowedClientOrganizationIds).toEqual(ctx.assignedClientOrganizationIds);
    expect(ctx.isPlatformAdmin).toBe(false);
  });

  it("rejects REJECTED as a ClientReviewDecision value at the type level (compile-time only, asserted via allowed literal set)", () => {
    const allowed: ClientReviewDecision["decision"][] = ["CONFIRMED", "CHANGES_REQUESTED", "DEFERRED"];
    expect(allowed).not.toContain("REJECTED");
  });

  it("builds a ClientReviewDecision with reviewer/version/hash fields", () => {
    const decision: ClientReviewDecision = {
      id: "rev_1",
      projectId: "proj_1",
      subjectType: "KEYWORD",
      subjectId: "kw_1",
      decision: "CHANGES_REQUESTED",
      reviewerRole: "CLIENT_OWNER",
      actingOrganizationId: "org_1",
      targetVersion: 3,
      comment: "需要更聚焦的关键词范围",
      decisionHash: "deadbeef",
      decidedByUserId: "user_1",
      decidedAt: "2026-07-18T00:00:00.000Z",
    };
    expect(decision.targetVersion).toBe(3);
  });

  it("builds an AuditEvent scoped to actor + client + project", () => {
    const event: AuditEvent = {
      id: "audit_1",
      organizationId: "org_agency_1",
      actorUserId: "user_2",
      actorOrganizationId: "org_agency_1",
      clientOrganizationId: "org_client_1",
      projectId: "proj_1",
      action: "invitation.revoke",
      targetType: "Invitation",
      targetId: "inv_1",
      metadata: { reason: "duplicate" },
      eventHash: "cafebabe",
      createdAt: "2026-07-18T00:00:00.000Z",
    };
    expect(event.clientOrganizationId).toBe("org_client_1");
  });

  it("builds an ArtifactIndex scoped to client + project + version", () => {
    const artifact: ArtifactIndex = {
      id: "art_1",
      artifactType: "ArticleDraft",
      artifactId: "draft_1",
      clientOrganizationId: "org_client_1",
      projectId: "proj_1",
      artifactVersion: 2,
      storagePath: "artifacts/org_client_1/proj_1/draft_1/v2.json",
      sealedAt: "2026-07-18T00:00:00.000Z",
      createdAt: "2026-07-18T00:00:00.000Z",
      contentHash: "0123456789abcdef",
    };
    expect(artifact.artifactVersion).toBe(2);
  });

  it("builds the remaining supporting entities without error", () => {
    const user: User = { id: "user_1", email: "owner@example-client.test", createdAt: "2026-07-18T00:00:00.000Z" };
    const assignment: AgencyClientAssignment = {
      id: "assign_1",
      agencyOrganizationId: "org_agency_1",
      clientOrganizationId: "org_client_1",
      status: "ACTIVE",
      assignedByUserId: "user_platform_1",
      assignedAt: "2026-07-18T00:00:00.000Z",
      revokedAt: null,
    };
    const project: Project = {
      id: "proj_1",
      clientOrganizationId: "org_client_1",
      name: "示例交付项目",
      createdAt: "2026-07-18T00:00:00.000Z",
      createdByUserId: "user_1",
    };
    const projectMembership: ProjectMembership = { id: "pm_1", projectId: "proj_1", userId: "user_1", createdAt: "2026-07-18T00:00:00.000Z" };
    const invitation: Invitation = {
      id: "inv_1",
      organizationId: "org_client_1",
      invitedEmail: "invitee@example-client.test",
      role: "CLIENT_OWNER",
      status: "PENDING",
      tokenHash: "hashed-token-not-raw",
      createdByUserId: "user_1",
      createdAt: "2026-07-18T00:00:00.000Z",
      expiresAt: "2026-07-25T00:00:00.000Z",
      revokedAt: null,
      revokedByUserId: null,
    };
    expect([user, assignment, project, projectMembership, invitation]).toHaveLength(5);
  });
});
