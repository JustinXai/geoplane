/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase test)
 * reconstruction_reason: CORE_RUNTIME_TRUE_PARALLEL — checkpoint ACCOUNT_AUTH_API_CONTRACT_V1.
 *   Exercises the account/auth service (src/runtime/auth/auth-service.ts) entirely against
 *   in-memory fakes of the consumer-defined ports (src/runtime/auth/ports.ts) — no database.
 * original_file_unavailable: n/a (net-new runtime-phase test)
 */
import { describe, expect, it } from "vitest";
import type {
  Invitation,
  Membership,
  Organization,
  Project,
  Session,
} from "../../../src/contracts/tenancy/entities.js";
import { hashInvitationToken } from "../../../src/contracts/tenancy/invitations.js";
import { decodeSessionCookie } from "../../../src/lib/session-cookie.js";
import {
  AuthService,
  type AuthenticatedSession,
} from "../../../src/runtime/auth/auth-service.js";
import type {
  AgencyAssignedClient,
  AuthServiceDeps,
} from "../../../src/runtime/auth/ports.js";

const NOW = new Date("2026-07-18T00:00:00.000Z");

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

interface Fixture {
  organizations: Organization[];
  memberships: Membership[];
  invitations: Invitation[];
  projects: Project[];
  /** agencyOrgId -> assigned client entries (ACTIVE only). */
  agencyAssignments: Map<string, AgencyAssignedClient[]>;
}

function org(id: string, type: Organization["type"], displayName: string): Organization {
  return {
    id,
    type,
    displayName,
    status: "ACTIVE",
    idempotencyKey: `idem_${id}`,
    sourceNamespace: null,
    externalReference: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByUserId: "user_seed",
  };
}

function membership(userId: string, organizationId: string, role: Membership["role"]): Membership {
  return {
    id: `mem_${userId}_${organizationId}`,
    userId,
    organizationId,
    role,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function project(id: string, clientOrganizationId: string, name: string): Project {
  return {
    id,
    clientOrganizationId,
    name,
    createdAt: "2026-02-01T00:00:00.000Z",
    createdByUserId: "user_seed",
  };
}

function invitation(overrides: Partial<Invitation> & { tokenHash: string }): Invitation {
  return {
    id: "inv_1",
    organizationId: "org_client_a",
    invitedEmail: "invitee@example.com",
    role: "CLIENT_OWNER",
    status: "PENDING",
    createdByUserId: "user_admin",
    createdAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-07-31T00:00:00.000Z",
    revokedAt: null,
    revokedByUserId: null,
    ...overrides,
  };
}

function buildDeps(fixture: Fixture): { deps: AuthServiceDeps; sessions: Map<string, Session> } {
  const sessions = new Map<string, Session>();

  const deps: AuthServiceDeps = {
    sessions: {
      async create(session) {
        sessions.set(session.id, session);
      },
      async find(sessionId) {
        return sessions.get(sessionId) ?? null;
      },
      async revoke(sessionId, now) {
        const existing = sessions.get(sessionId);
        if (existing) sessions.set(sessionId, { ...existing, revokedAt: now.toISOString() });
      },
    },
    invitations: {
      async findByTokenHash(tokenHash) {
        return fixture.invitations.find((i) => i.tokenHash === tokenHash) ?? null;
      },
    },
    memberships: {
      async listActiveByUser(userId) {
        return fixture.memberships.filter((m) => m.userId === userId && m.status === "ACTIVE");
      },
    },
    organizations: {
      async findById(organizationId) {
        return fixture.organizations.find((o) => o.id === organizationId) ?? null;
      },
    },
    agencyClients: {
      async listActiveClientsForAgency(agencyOrganizationId) {
        return fixture.agencyAssignments.get(agencyOrganizationId) ?? [];
      },
      async isAgencyAuthorizedForClient(agencyOrganizationId, clientOrganizationId) {
        const assigned = fixture.agencyAssignments.get(agencyOrganizationId) ?? [];
        return assigned.some((c) => c.clientOrganizationId === clientOrganizationId);
      },
    },
    projects: {
      async findById(projectId) {
        return fixture.projects.find((p) => p.id === projectId) ?? null;
      },
      async listForClient(clientOrganizationId) {
        return fixture.projects.filter((p) => p.clientOrganizationId === clientOrganizationId);
      },
    },
  };

  return { deps, sessions };
}

function baseFixture(): Fixture {
  return {
    organizations: [
      org("org_client_a", "CLIENT", "Client A"),
      org("org_client_b", "CLIENT", "Client B"),
      org("org_agency", "AGENCY", "Agency X"),
      org("org_platform", "PLATFORM", "Platform"),
    ],
    memberships: [
      membership("user_client_a", "org_client_a", "CLIENT_OWNER"),
      membership("user_agency", "org_agency", "AGENCY_OWNER"),
    ],
    invitations: [],
    projects: [
      project("proj_a1", "org_client_a", "Client A Project 1"),
      project("proj_b1", "org_client_b", "Client B Project 1"),
    ],
    agencyAssignments: new Map<string, AgencyAssignedClient[]>([
      [
        "org_agency",
        [{ clientOrganizationId: "org_client_a", clientOrganizationName: "Client A", openReviewCount: 3 }],
      ],
    ]),
  };
}

function agencySession(overrides: Partial<AuthenticatedSession> = {}): AuthenticatedSession {
  return {
    sessionId: "sess_agency",
    userId: "user_agency",
    email: "agency@example.com",
    displayName: "Agency Owner",
    role: "AGENCY_OWNER",
    organizationId: "org_agency",
    organizationType: "AGENCY",
    activeClientOrganizationId: null,
    assignedClientOrganizationIds: ["org_client_a"],
    actingClientOrganizationId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService.login + getAccount", () => {
  it("logs a CLIENT_OWNER in, pins them to their own client org, and issues the acceptance cookie", async () => {
    const { deps, sessions } = buildDeps(baseFixture());
    const svc = new AuthService(deps);

    const res = await svc.login({
      user: { id: "user_client_a", email: "owner@clienta.example", displayName: "Owner A" },
      now: NOW,
      sessionId: "sess_1",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");

    const { account, session, sessionCookie } = res.data;
    expect(account.userId).toBe("user_client_a");
    expect(account.role).toBe("CLIENT_OWNER");
    expect(account.surface).toBe("client");
    expect(account.organizationId).toBe("org_client_a");
    expect(account.activeClientOrganizationId).toBe("org_client_a");

    // A real Session was persisted via the store port.
    expect(sessions.get("sess_1")).toBeDefined();
    expect(session.sessionId).toBe("sess_1");

    // Cookie is exactly the shape middleware.ts decodes.
    const decoded = decodeSessionCookie(sessionCookie);
    expect(decoded).toEqual({
      actorUserId: "user_client_a",
      role: "CLIENT_OWNER",
      organizationId: "org_client_a",
      organizationType: "CLIENT",
      activeClientOrganizationId: "org_client_a",
    });

    // getAccount over the resolved session returns the same view.
    const acct = await svc.getAccount(session);
    expect(acct.ok).toBe(true);
    if (acct.ok) expect(acct.data.organizationName).toBe("Client A");
  });

  it("rejects login for a user with no active membership", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);
    const res = await svc.login({ user: { id: "ghost", email: "ghost@x.example" }, now: NOW });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("UNAUTHENTICATED");
  });

  it("logout revokes the persisted session", async () => {
    const { deps, sessions } = buildDeps(baseFixture());
    const svc = new AuthService(deps);
    await svc.login({
      user: { id: "user_client_a", email: "owner@clienta.example" },
      now: NOW,
      sessionId: "sess_1",
    });
    const res = await svc.logout("sess_1", NOW);
    expect(res.ok).toBe(true);
    expect(sessions.get("sess_1")?.revokedAt).toBe(NOW.toISOString());
  });
});

describe("CLIENT_OWNER cannot switch client org", () => {
  it("a CLIENT_OWNER session cannot select an agency-style client context (FORBIDDEN)", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);

    const clientSession: AuthenticatedSession = {
      sessionId: "sess_c",
      userId: "user_client_a",
      email: "owner@clienta.example",
      displayName: null,
      role: "CLIENT_OWNER",
      organizationId: "org_client_a",
      organizationType: "CLIENT",
      activeClientOrganizationId: "org_client_a",
      assignedClientOrganizationIds: [],
      actingClientOrganizationId: null,
    };

    const res = await svc.setAgencyContext(clientSession, "org_client_b");
    expect(res.response.ok).toBe(false);
    if (!res.response.ok) expect(res.response.error.code).toBe("FORBIDDEN");
  });

  it("a CLIENT_OWNER cannot read another tenant's project (FORBIDDEN + audit intent)", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);

    const clientSession: AuthenticatedSession = {
      sessionId: "sess_c",
      userId: "user_client_a",
      email: "owner@clienta.example",
      displayName: null,
      role: "CLIENT_OWNER",
      organizationId: "org_client_a",
      organizationType: "CLIENT",
      activeClientOrganizationId: "org_client_a",
      assignedClientOrganizationIds: [],
      actingClientOrganizationId: null,
    };

    // Own project: allowed.
    const own = await svc.getProject(clientSession, "proj_a1");
    expect(own.response.ok).toBe(true);

    // Cross-tenant project: forbidden, with a DENIED audit intent.
    const cross = await svc.getProject(clientSession, "proj_b1");
    expect(cross.response.ok).toBe(false);
    if (!cross.response.ok) expect(cross.response.error.code).toBe("FORBIDDEN");
    expect(cross.auditIntents).toHaveLength(1);
    const intent = cross.auditIntents[0];
    expect(intent?.outcome).toBe("DENIED");
    expect(intent?.projectId).toBe("proj_b1");
  });
});

describe("Agency client authorization", () => {
  it("lists only ACTIVE-assigned clients with project + open-review counts", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);

    const res = await svc.listAgencyClients(agencySession());
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");

    expect(res.data.agencyOrganizationId).toBe("org_agency");
    expect(res.data.clients).toHaveLength(1);
    const item = res.data.clients[0];
    expect(item?.clientOrganizationId).toBe("org_client_a");
    expect(item?.projectCount).toBe(1);
    expect(item?.openReviewCount).toBe(3);
  });

  it("a non-agency role cannot list the agency portfolio (FORBIDDEN)", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);
    const clientSession = agencySession({
      role: "CLIENT_OWNER",
      organizationType: "CLIENT",
      organizationId: "org_client_a",
    });
    const res = await svc.listAgencyClients(clientSession);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  it("setAgencyContext succeeds for an authorized client and emits an access-context-changed intent", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);

    const res = await svc.setAgencyContext(agencySession(), "org_client_a");
    expect(res.response.ok).toBe(true);
    if (res.response.ok) {
      expect(res.response.data.actingClientOrganizationId).toBe("org_client_a");
      expect(res.response.data.surface).toBe("agency");
    }
    expect(res.session.actingClientOrganizationId).toBe("org_client_a");
    expect(res.auditIntents).toHaveLength(1);
    expect(res.auditIntents[0]?.action).toBe("access-context-changed");
    expect(res.auditIntents[0]?.outcome).toBe("ALLOWED");
  });

  it("setAgencyContext rejects an unauthorized client with FORBIDDEN + a DENIED audit intent", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);

    const res = await svc.setAgencyContext(agencySession(), "org_client_b");
    expect(res.response.ok).toBe(false);
    if (!res.response.ok) expect(res.response.error.code).toBe("FORBIDDEN");
    expect(res.session.actingClientOrganizationId).toBeNull();
    expect(res.auditIntents).toHaveLength(1);
    expect(res.auditIntents[0]?.outcome).toBe("DENIED");
  });

  it("an agency can read an assigned client's project but not an unassigned client's (FORBIDDEN)", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);

    const assigned = await svc.getProject(agencySession(), "proj_a1");
    expect(assigned.response.ok).toBe(true);

    const unassigned = await svc.getProject(agencySession(), "proj_b1");
    expect(unassigned.response.ok).toBe(false);
    if (!unassigned.response.ok) expect(unassigned.response.error.code).toBe("FORBIDDEN");
    expect(unassigned.auditIntents[0]?.outcome).toBe("DENIED");
  });

  it("once an agency has selected a client, it cannot read a different assigned client's project", async () => {
    const fixture = baseFixture();
    // Assign a second client so base authorization would otherwise allow it.
    fixture.agencyAssignments.set("org_agency", [
      { clientOrganizationId: "org_client_a", clientOrganizationName: "Client A", openReviewCount: 0 },
      { clientOrganizationId: "org_client_b", clientOrganizationName: "Client B", openReviewCount: 0 },
    ]);
    const { deps } = buildDeps(fixture);
    const svc = new AuthService(deps);

    const acting = agencySession({
      assignedClientOrganizationIds: ["org_client_a", "org_client_b"],
      actingClientOrganizationId: "org_client_a",
    });

    // Acting for A: A's project is fine.
    const okA = await svc.getProject(acting, "proj_a1");
    expect(okA.response.ok).toBe(true);

    // Acting for A: B's project is blocked even though B is assigned.
    const blockedB = await svc.getProject(acting, "proj_b1");
    expect(blockedB.response.ok).toBe(false);
    if (!blockedB.response.ok) expect(blockedB.response.error.code).toBe("FORBIDDEN");
  });
});

describe("Invitation acceptance", () => {
  it("accepts a PENDING invitation for the matching invitee and returns the resulting account view", async () => {
    const token = "raw-token-happy";
    const tokenHash = hashInvitationToken(token);
    const fixture = baseFixture();
    fixture.invitations.push(
      invitation({ tokenHash, invitedEmail: "invitee@example.com", organizationId: "org_client_a", role: "CLIENT_OWNER" }),
    );
    const { deps } = buildDeps(fixture);
    const svc = new AuthService(deps);

    const res = await svc.acceptInvitation({
      tokenHash,
      user: { id: "user_new", email: "invitee@example.com", displayName: "New Owner" },
      now: NOW,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.role).toBe("CLIENT_OWNER");
      expect(res.data.organizationId).toBe("org_client_a");
      expect(res.data.activeClientOrganizationId).toBe("org_client_a");
    }
  });

  it("rejects an expired invitation (CONFLICT)", async () => {
    const token = "raw-token-expired";
    const tokenHash = hashInvitationToken(token);
    const fixture = baseFixture();
    fixture.invitations.push(
      invitation({ tokenHash, expiresAt: "2026-07-01T00:00:00.000Z" }), // before NOW
    );
    const { deps } = buildDeps(fixture);
    const svc = new AuthService(deps);

    const res = await svc.acceptInvitation({
      tokenHash,
      user: { id: "user_new", email: "invitee@example.com" },
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("CONFLICT");
      expect(res.error.details?.status).toBe("EXPIRED");
    }
  });

  it("rejects a revoked invitation (CONFLICT)", async () => {
    const token = "raw-token-revoked";
    const tokenHash = hashInvitationToken(token);
    const fixture = baseFixture();
    fixture.invitations.push(
      invitation({ tokenHash, status: "REVOKED", revokedAt: "2026-07-05T00:00:00.000Z", revokedByUserId: "user_admin" }),
    );
    const { deps } = buildDeps(fixture);
    const svc = new AuthService(deps);

    const res = await svc.acceptInvitation({
      tokenHash,
      user: { id: "user_new", email: "invitee@example.com" },
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONFLICT");
  });

  it("returns NOT_FOUND for an unknown token hash", async () => {
    const { deps } = buildDeps(baseFixture());
    const svc = new AuthService(deps);
    const res = await svc.acceptInvitation({
      tokenHash: hashInvitationToken("nope"),
      user: { id: "user_new", email: "invitee@example.com" },
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NOT_FOUND");
  });

  it("rejects acceptance by a different email than the invitation targeted (FORBIDDEN)", async () => {
    const token = "raw-token-mismatch";
    const tokenHash = hashInvitationToken(token);
    const fixture = baseFixture();
    fixture.invitations.push(invitation({ tokenHash, invitedEmail: "invitee@example.com" }));
    const { deps } = buildDeps(fixture);
    const svc = new AuthService(deps);

    const res = await svc.acceptInvitation({
      tokenHash,
      user: { id: "user_other", email: "someone-else@example.com" },
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
