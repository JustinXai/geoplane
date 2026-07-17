/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/tenancy/sessions.ts (checkpoint B4),
 *   see that file's header for full provenance.
 * reconstruction_reason: no original tests for session issuance/staleness
 *   logic were recoverable.
 * original_file_unavailable: true
 *
 * Checkpoint B4 - tests for src/contracts/tenancy/sessions.ts.
 */
import { describe, expect, it } from "vitest";
import type { AuthorizationContext, Membership } from "../../src/contracts/tenancy/entities.js";
import {
  type CurrentMembershipSessionVersion,
  isSessionValid,
  isSessionVersionCurrent,
  issueSession,
} from "../../src/contracts/tenancy/sessions.js";

const NOW = new Date("2026-07-18T00:00:00.000Z");

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: "mem_1",
    userId: "user_1",
    organizationId: "org_client_a",
    role: "CLIENT_OWNER",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function ctx(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    actorUserId: "user_1",
    actorRole: "CLIENT_OWNER",
    organizationId: "org_client_a",
    organizationType: "CLIENT",
    activeProjectId: "proj_1",
    activeClientOrganizationId: "org_client_a",
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: false,
    permissions: [],
    ...overrides,
  };
}

describe("tenancy sessions B4", () => {
  it("issues a Session snapshotting role/activeClientOrganizationId/activeProjectId from the AuthorizationContext", () => {
    const mem = membership();
    const version: CurrentMembershipSessionVersion = { membershipId: mem.id, sessionVersion: 1 };
    const c = ctx();

    const session = issueSession(mem, version, c, { now: NOW });

    expect(session.userId).toBe(mem.userId);
    expect(session.membershipId).toBe(mem.id);
    expect(session.organizationId).toBe(mem.organizationId);
    expect(session.role).toBe(c.actorRole);
    expect(session.activeClientOrganizationId).toBe(c.activeClientOrganizationId);
    expect(session.activeProjectId).toBe(c.activeProjectId);
    expect(session.sessionVersion).toBe(1);
    expect(session.revokedAt).toBeNull();
  });

  it("a session issued at sessionVersion=1 is rejected once the current membership sessionVersion has incremented to 2", () => {
    const mem = membership();
    const issuedAtVersion: CurrentMembershipSessionVersion = { membershipId: mem.id, sessionVersion: 1 };
    const session = issueSession(mem, issuedAtVersion, ctx(), { now: NOW });

    // Still valid against the same version it was issued at.
    expect(isSessionVersionCurrent(session, issuedAtVersion)).toBe(true);
    expect(isSessionValid(session, issuedAtVersion, NOW)).toBe(true);

    // The membership's role/assignment changed since, bumping the live counter.
    const bumpedVersion: CurrentMembershipSessionVersion = { membershipId: mem.id, sessionVersion: 2 };
    expect(isSessionVersionCurrent(session, bumpedVersion)).toBe(false);
    expect(isSessionValid(session, bumpedVersion, NOW)).toBe(false);
  });

  it("a revoked session is invalid even at the current sessionVersion", () => {
    const mem = membership();
    const version: CurrentMembershipSessionVersion = { membershipId: mem.id, sessionVersion: 1 };
    const session = issueSession(mem, version, ctx(), { now: NOW });
    const revokedSession = { ...session, revokedAt: NOW.toISOString() };

    expect(isSessionValid(revokedSession, version, NOW)).toBe(false);
  });

  it("an expired session is invalid even at the current sessionVersion", () => {
    const mem = membership();
    const version: CurrentMembershipSessionVersion = { membershipId: mem.id, sessionVersion: 1 };
    const session = issueSession(mem, version, ctx(), { now: NOW, ttlMs: 1000 });
    const wayLater = new Date(NOW.getTime() + 1000 * 60 * 60);

    expect(isSessionValid(session, version, wayLater)).toBe(false);
  });

  it("isSessionVersionCurrent throws on a membershipId mismatch rather than silently comparing unrelated sessions", () => {
    const mem = membership();
    const version: CurrentMembershipSessionVersion = { membershipId: mem.id, sessionVersion: 1 };
    const session = issueSession(mem, version, ctx(), { now: NOW });

    const unrelatedVersion: CurrentMembershipSessionVersion = { membershipId: "mem_other", sessionVersion: 1 };
    expect(() => isSessionVersionCurrent(session, unrelatedVersion)).toThrow(/does not match/);
  });

  it("issueSession rejects a membership/currentVersion pair that don't refer to the same membership", () => {
    const mem = membership();
    const mismatchedVersion: CurrentMembershipSessionVersion = { membershipId: "mem_other", sessionVersion: 1 };
    expect(() => issueSession(mem, mismatchedVersion, ctx(), { now: NOW })).toThrow(/does not match/);
  });
});
