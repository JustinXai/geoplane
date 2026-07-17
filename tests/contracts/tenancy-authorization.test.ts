/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
 *   docs/governance/SYSTEM_INVARIANTS_V1.md
 * reconstruction_reason: no original authorization service code (or its
 *   tests) recoverable
 * original_file_unavailable: true
 *
 * Checkpoint B2 — tenant-isolation tests for
 * src/contracts/tenancy/authorization.ts. These exercise real allow/deny
 * behavior, not just type shapes.
 */
import { describe, expect, it } from "vitest";
import type { AuthorizationContext } from "../../src/contracts/tenancy/entities.js";
import {
  AuthorizationDeniedError,
  assertCanAccessClientOrganization,
  canAccessClientOrganization,
} from "../../src/contracts/tenancy/authorization.js";

function clientOwnerCtx(activeClientOrganizationId: string | null): AuthorizationContext {
  return {
    actorUserId: "user_client_owner_a",
    actorRole: "CLIENT_OWNER",
    organizationId: activeClientOrganizationId ?? "org_client_a",
    organizationType: "CLIENT",
    activeProjectId: null,
    activeClientOrganizationId,
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: false,
    permissions: [],
  };
}

function agencyCtx(actorRole: "AGENCY_OWNER" | "AGENCY_OPERATOR", allowedClientOrganizationIds: string[]): AuthorizationContext {
  return {
    actorUserId: "user_agency_a",
    actorRole,
    organizationId: "org_agency_a",
    organizationType: "AGENCY",
    activeProjectId: null,
    activeClientOrganizationId: null,
    assignedClientOrganizationIds: allowedClientOrganizationIds,
    allowedClientOrganizationIds,
    isPlatformAdmin: false,
    permissions: [],
  };
}

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

describe("tenancy authorization B2", () => {
  const CLIENT_A = "org_client_a";
  const CLIENT_B = "org_client_b";

  it("CLIENT_OWNER: Client A cannot access Client B's organization", () => {
    const ctx = clientOwnerCtx(CLIENT_A);
    expect(canAccessClientOrganization(ctx, CLIENT_B)).toBe(false);
    expect(() => assertCanAccessClientOrganization(ctx, CLIENT_B)).toThrow(AuthorizationDeniedError);
  });

  it("CLIENT_OWNER: Client A CAN access their own (only) active client organization", () => {
    const ctx = clientOwnerCtx(CLIENT_A);
    expect(canAccessClientOrganization(ctx, CLIENT_A)).toBe(true);
    expect(() => assertCanAccessClientOrganization(ctx, CLIENT_A)).not.toThrow();
  });

  it("CLIENT_OWNER: a context with no active client org (null) can access nothing", () => {
    const ctx = clientOwnerCtx(null);
    expect(canAccessClientOrganization(ctx, CLIENT_A)).toBe(false);
  });

  it("AGENCY: Agency A cannot access an unassigned client", () => {
    const ctx = agencyCtx("AGENCY_OPERATOR", []);
    expect(canAccessClientOrganization(ctx, CLIENT_A)).toBe(false);
    expect(() => assertCanAccessClientOrganization(ctx, CLIENT_A)).toThrow(AuthorizationDeniedError);
  });

  it("AGENCY: Agency A CAN access an explicitly, actively assigned client", () => {
    const ctx = agencyCtx("AGENCY_OWNER", [CLIENT_A]);
    expect(canAccessClientOrganization(ctx, CLIENT_A)).toBe(true);
    expect(() => assertCanAccessClientOrganization(ctx, CLIENT_A)).not.toThrow();
  });

  it("AGENCY: Agency A cannot access a client whose assignment is REVOKED (absent from allow-list, not merely unlisted-but-known)", () => {
    // Simulates session resolution: a REVOKED AgencyClientAssignment row
    // must never appear in allowedClientOrganizationIds. Even though the
    // agency once had access to CLIENT_B (and may still reference its ID
    // elsewhere, e.g. historical audit logs), the resolved context reflects
    // only the currently-ACTIVE assignment (CLIENT_A).
    const ctx = agencyCtx("AGENCY_OPERATOR", [CLIENT_A]); // CLIENT_B's assignment was revoked, so it is absent here
    expect(canAccessClientOrganization(ctx, CLIENT_B)).toBe(false);
    expect(() => assertCanAccessClientOrganization(ctx, CLIENT_B)).toThrow(AuthorizationDeniedError);
  });

  it("PLATFORM_SUPER_ADMIN can access every organization type/id tested above", () => {
    const ctx = platformAdminCtx();
    expect(canAccessClientOrganization(ctx, CLIENT_A)).toBe(true);
    expect(canAccessClientOrganization(ctx, CLIENT_B)).toBe(true);
    expect(canAccessClientOrganization(ctx, "org_client_unassigned_anything")).toBe(true);
    expect(() => assertCanAccessClientOrganization(ctx, CLIENT_A)).not.toThrow();
    expect(() => assertCanAccessClientOrganization(ctx, CLIENT_B)).not.toThrow();
  });

  it("PLATFORM_SUPER_ADMIN role grants access even if isPlatformAdmin flag were ever false (role is authoritative, defense in depth)", () => {
    const ctx: AuthorizationContext = { ...platformAdminCtx(), isPlatformAdmin: false };
    expect(canAccessClientOrganization(ctx, CLIENT_A)).toBe(true);
  });

  it("a CLIENT_OWNER's resolved context cannot be coerced into a different activeClientOrganizationId via the target-id argument alone", () => {
    // The function signature is (ctx, targetClientOrgId) — there is no
    // second "claimed org id" parameter for a caller to inject. A caller
    // who only controls targetClientOrgId (e.g. a route param) can never
    // get an affirmative answer for any org other than the one already
    // baked into ctx.activeClientOrganizationId by session resolution.
    const resolvedCtx = clientOwnerCtx(CLIENT_A);

    // Attempting to "switch" mid-session by passing a different target org
    // (as if the caller supplied a different org id in the request) is
    // denied — the ctx itself was never mutated/re-resolved.
    expect(canAccessClientOrganization(resolvedCtx, CLIENT_B)).toBe(false);

    // Even constructing a *new* ctx object that only changes the target org
    // while keeping the same actor identity fields makes explicit that
    // "switching" requires a wholesale new resolved context, not a
    // parameter the request could supply piecemeal - and per the frozen
    // invariant, a CLIENT_OWNER's session-resolved activeClientOrganizationId
    // is fixed for the session, so no legitimate resolution path produces
    // this second context from the same session either.
    const differentlyResolvedCtx = clientOwnerCtx(CLIENT_B);
    expect(canAccessClientOrganization(differentlyResolvedCtx, CLIENT_B)).toBe(true);
    expect(canAccessClientOrganization(differentlyResolvedCtx, CLIENT_A)).toBe(false);

    // Original resolved context is untouched by the existence of the second
    // one - no shared mutable state lets one session's resolution leak into
    // another's.
    expect(resolvedCtx.activeClientOrganizationId).toBe(CLIENT_A);
  });

  it("AGENCY_OWNER and AGENCY_OPERATOR are both governed by the same allow-list rule", () => {
    const owner = agencyCtx("AGENCY_OWNER", [CLIENT_A]);
    const operator = agencyCtx("AGENCY_OPERATOR", [CLIENT_A]);
    expect(canAccessClientOrganization(owner, CLIENT_A)).toBe(true);
    expect(canAccessClientOrganization(operator, CLIENT_A)).toBe(true);
    expect(canAccessClientOrganization(owner, CLIENT_B)).toBe(false);
    expect(canAccessClientOrganization(operator, CLIENT_B)).toBe(false);
  });

  it("AuthorizationDeniedError carries actor/target detail for audit logging without implying the target exists", () => {
    const ctx = clientOwnerCtx(CLIENT_A);
    try {
      assertCanAccessClientOrganization(ctx, CLIENT_B);
      throw new Error("expected assertCanAccessClientOrganization to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationDeniedError);
      const denied = err as AuthorizationDeniedError;
      expect(denied.actorUserId).toBe(ctx.actorUserId);
      expect(denied.targetClientOrganizationId).toBe(CLIENT_B);
    }
  });
});
