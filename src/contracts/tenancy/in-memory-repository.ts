/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
 *   docs/governance/SYSTEM_INVARIANTS_V1.md, src/contracts/tenancy/entities.ts
 *   (checkpoint B1/B1-CORRECTION), src/contracts/tenancy/authorization.ts
 *   (checkpoint B2 - canAccessClientOrganization/assertCanAccessClientOrganization/
 *   isPlatformAdmin), migrations/0001_tenancy_foundation.sql (checkpoint B3 -
 *   uq_organization_idempotency_key, uq_membership_one_active_client_org_per_user),
 *   src/contracts/tenancy/invitations.ts + sessions.ts + audit.ts (checkpoint
 *   B4), and recovered/partial-source/00040000000C9C455B787075-route.ts +
 *   00040000000C9C6422CCAB4F-page.tsx (real recovered `tenancyRepository`
 *   call-site evidence for listOrganizations/listAudit/revokeInvitation, see
 *   entities.ts's and invitations.ts's headers for the direct quotes).
 * reconstruction_reason: no original `tenancyRepository` implementation was
 *   recoverable from E:\GEO_RECOVERY_SAFE. The recovered partial-source files
 *   confirm the *call shape* of `tenancyRepository.listOrganizations()`,
 *   `tenancyRepository.listAudit()`, and `tenancyRepository.revokeInvitation()`
 *   (see MULTI_TENANT_ACCOUNT_MODEL_V1.md's "Evidence corroboration" section),
 *   not the repository's internal storage/enforcement, which is reconstructed
 *   here from the frozen invariants in migrations/0001_tenancy_foundation.sql.
 * original_file_unavailable: true
 *
 * Checkpoint B5 - In-memory tenancy repository (closing checkpoint for the
 * current TENANCY_AUTH_OFFLINE_FOUNDATION_V1 scope).
 *
 * Purpose: prove, purely in application code and with no database, that the
 * invariants migrations/0001_tenancy_foundation.sql enforces at the Postgres
 * level are *also* enforceable (and testable) at the application layer, and
 * give every prior checkpoint (B1 entities, B2 authorization, B4 business
 * logic) something real to compose against end-to-end:
 *
 *   - createOrganization(): mirrors uq_organization_idempotency_key - calling
 *     it twice with the same idempotencyKey returns the SAME organization
 *     record, never a duplicate.
 *   - createMembership(): mirrors uq_membership_one_active_client_org_per_user
 *     - a second ACTIVE membership into a CLIENT-type organization for a user
 *     who already holds one throws MembershipConflictError. This is an
 *     in-memory index check (an `activeClientMembershipByUser` map), not a
 *     database constraint - it is intentionally analogous to, not the same
 *     mechanism as, the Postgres partial unique index it mirrors.
 *   - listOrganizations(): calls authorization.ts's real
 *     `canAccessClientOrganization` (and `isPlatformAdmin`) per candidate
 *     CLIENT/AGENCY organization - this file does not reimplement the
 *     tenant-isolation rule, it composes with B2's implementation of it.
 *   - issueAndRecordInvitation()/revokeAndRecordInvitation(): wrap B4's
 *     invitations.ts issueInvitation()/revokeInvitation() and additionally
 *     call B4's audit.ts recordAuditEvent() for each action, proving the
 *     three B4 modules actually compose end-to-end through a single
 *     repository surface.
 *   - listAudit(): returns the AuditEvent rows recorded against an
 *     organization, sorted by createdAt.
 *
 * Scope note: this is a plain in-memory Map-backed implementation - no real
 * database, no real async I/O, no persistence across process restarts. It
 * exists to prove composition and invariant-enforcement at this checkpoint,
 * not to be production infrastructure. A future checkpoint implementing a
 * real Postgres-backed repository against migrations/0001_tenancy_foundation.sql
 * is expected to satisfy the same invariants this file's tests exercise.
 */
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  AuthorizationContext,
  Invitation,
  Membership,
  MembershipStatus,
  Organization,
  OrganizationStatus,
  OrganizationType,
  PlatformRole,
} from "./entities.js";
import { canAccessClientOrganization, isPlatformAdmin } from "./authorization.js";
import { issueInvitation, revokeInvitation, type IssueInvitationInput, type RevokeInvitationArgs } from "./invitations.js";
import { recordAuditEvent } from "./audit.js";

/**
 * Thrown by createMembership when a second ACTIVE membership into a
 * CLIENT-type organization is attempted for a user who already holds one.
 * Mirrors migrations/0001_tenancy_foundation.sql's
 * `uq_membership_one_active_client_org_per_user` partial unique index - a
 * real error, not a silent no-op/overwrite.
 */
export class MembershipConflictError extends Error {
  readonly userId: string;
  readonly existingClientOrganizationId: string;
  readonly attemptedClientOrganizationId: string;

  constructor(userId: string, existingClientOrganizationId: string, attemptedClientOrganizationId: string) {
    super(
      `User ${userId} already holds an ACTIVE membership in CLIENT organization ` +
        `${existingClientOrganizationId}; cannot also create an ACTIVE membership in CLIENT ` +
        `organization ${attemptedClientOrganizationId}. A CLIENT user may belong to at most one ` +
        `ACTIVE CLIENT organization at a time (SYSTEM_INVARIANTS_V1.md).`,
    );
    this.name = "MembershipConflictError";
    this.userId = userId;
    this.existingClientOrganizationId = existingClientOrganizationId;
    this.attemptedClientOrganizationId = attemptedClientOrganizationId;
  }
}

export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization ${organizationId} does not exist.`);
    this.name = "OrganizationNotFoundError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor(invitationId: string) {
    super(`Invitation ${invitationId} does not exist.`);
    this.name = "InvitationNotFoundError";
  }
}

export interface CreateOrganizationInput {
  /** Optional caller-supplied id (e.g. deterministic tests); random UUID otherwise. */
  id?: string;
  type: OrganizationType;
  displayName: string;
  status?: OrganizationStatus;
  /** Idempotency key for creation requests - see entities.ts Organization.idempotencyKey. */
  idempotencyKey: string;
  sourceNamespace?: string | null;
  externalReference?: string | null;
  createdByUserId: string;
  now: Date;
}

export interface CreateMembershipInput {
  /** Optional caller-supplied id (e.g. deterministic tests); random UUID otherwise. */
  id?: string;
  userId: string;
  organizationId: string;
  role: PlatformRole;
  /** Defaults to "ACTIVE". */
  status?: MembershipStatus;
  now: Date;
}

/**
 * `issueInvitation`'s input, minus the fields this method derives itself
 * (`createdByUserId` comes from `actor.actorUserId`) - the actor's identity
 * is always sourced from a server-resolved AuthorizationContext, never a
 * caller-supplied user id, per authorization.ts's rule for this module.
 */
export type IssueAndRecordInvitationInput = Omit<IssueInvitationInput, "createdByUserId"> & {
  actor: AuthorizationContext;
};

/**
 * In-memory, Map-backed tenancy repository. See module header for scope and
 * the invariants this class is responsible for proving at the application
 * layer.
 */
export class InMemoryTenancyRepository {
  private readonly organizationsById = new Map<string, Organization>();
  private readonly organizationIdByIdempotencyKey = new Map<string, string>();

  private readonly membershipsById = new Map<string, Membership>();
  /** userId -> membershipId of that user's single ACTIVE CLIENT-type membership, if any. */
  private readonly activeClientMembershipByUser = new Map<string, string>();

  private readonly invitationsById = new Map<string, Invitation>();

  private readonly auditEvents: AuditEvent[] = [];

  // -- Organization -----------------------------------------------------

  /**
   * Creates an Organization, or - if `input.idempotencyKey` was already used
   * - returns the SAME previously-created Organization untouched. Mirrors
   * migrations/0001_tenancy_foundation.sql's `uq_organization_idempotency_key`
   * unique constraint: calling this twice with the same key never produces a
   * duplicate row.
   */
  createOrganization(input: CreateOrganizationInput): Organization {
    const existingId = this.organizationIdByIdempotencyKey.get(input.idempotencyKey);
    if (existingId !== undefined) {
      const existing = this.organizationsById.get(existingId);
      if (existing === undefined) {
        throw new Error(
          `InMemoryTenancyRepository invariant violation: idempotency key ${input.idempotencyKey} ` +
            `is indexed to organization ${existingId}, which no longer exists.`,
        );
      }
      return existing;
    }

    const organization: Organization = {
      id: input.id ?? randomUUID(),
      type: input.type,
      displayName: input.displayName,
      status: input.status ?? "ACTIVE",
      idempotencyKey: input.idempotencyKey,
      sourceNamespace: input.sourceNamespace ?? null,
      externalReference: input.externalReference ?? null,
      createdAt: input.now.toISOString(),
      createdByUserId: input.createdByUserId,
    };

    this.organizationsById.set(organization.id, organization);
    this.organizationIdByIdempotencyKey.set(input.idempotencyKey, organization.id);
    return organization;
  }

  getOrganization(organizationId: string): Organization | undefined {
    return this.organizationsById.get(organizationId);
  }

  /**
   * Returns only the organizations `ctx` is authorized to see:
   *
   *   - `ctx.isPlatformAdmin` (or the PLATFORM_SUPER_ADMIN role - see
   *     authorization.ts's `isPlatformAdmin`) sees every organization,
   *     including PLATFORM-type ones.
   *   - Everyone else sees only CLIENT/AGENCY organizations for which
   *     authorization.ts's real `canAccessClientOrganization(ctx, org.id)`
   *     returns true - never a PLATFORM-type organization, and never a
   *     CLIENT/AGENCY organization this repository decided was visible on
   *     its own say-so. This is deliberately a call into B2's function, not
   *     a reimplementation of its rule.
   */
  listOrganizations(ctx: AuthorizationContext): Organization[] {
    const all = Array.from(this.organizationsById.values());
    if (isPlatformAdmin(ctx)) {
      return all;
    }
    return all.filter((organization) => {
      if (organization.type === "PLATFORM") {
        return false;
      }
      return canAccessClientOrganization(ctx, organization.id);
    });
  }

  // -- Membership ---------------------------------------------------------

  /**
   * Creates a Membership. If `status` (defaulting to "ACTIVE") is ACTIVE and
   * the target organization is CLIENT-type, enforces "at most one ACTIVE
   * CLIENT-type membership per user" - mirroring
   * migrations/0001_tenancy_foundation.sql's
   * `uq_membership_one_active_client_org_per_user` partial unique index -
   * by throwing MembershipConflictError (never silently dropping/ignoring
   * the second attempt) if the user already holds one, in a different
   * organization.
   */
  createMembership(input: CreateMembershipInput): Membership {
    const organization = this.organizationsById.get(input.organizationId);
    if (organization === undefined) {
      throw new OrganizationNotFoundError(input.organizationId);
    }

    const status = input.status ?? "ACTIVE";

    if (status === "ACTIVE" && organization.type === "CLIENT") {
      const existingMembershipId = this.activeClientMembershipByUser.get(input.userId);
      if (existingMembershipId !== undefined) {
        const existingMembership = this.membershipsById.get(existingMembershipId);
        if (existingMembership !== undefined && existingMembership.organizationId !== input.organizationId) {
          throw new MembershipConflictError(input.userId, existingMembership.organizationId, input.organizationId);
        }
      }
    }

    const membership: Membership = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      organizationId: input.organizationId,
      role: input.role,
      status,
      createdAt: input.now.toISOString(),
    };

    this.membershipsById.set(membership.id, membership);
    if (status === "ACTIVE" && organization.type === "CLIENT") {
      this.activeClientMembershipByUser.set(input.userId, membership.id);
    }
    return membership;
  }

  getMembership(membershipId: string): Membership | undefined {
    return this.membershipsById.get(membershipId);
  }

  // -- Invitation + Audit (B4 composition) ---------------------------------

  /**
   * Wraps invitations.ts's `issueInvitation` (createdByUserId is sourced
   * from `input.actor.actorUserId`, a server-resolved identity - never a
   * caller-supplied user id) and additionally calls audit.ts's
   * `recordAuditEvent` to append an "invitation.issue" AuditEvent scoped to
   * the invitation's organization.
   */
  issueAndRecordInvitation(input: IssueAndRecordInvitationInput) {
    const issued = issueInvitation({
      id: input.id,
      organizationId: input.organizationId,
      invitedEmail: input.invitedEmail,
      role: input.role,
      createdByUserId: input.actor.actorUserId,
      now: input.now,
      ttlMs: input.ttlMs,
      token: input.token,
    });

    this.invitationsById.set(issued.invitation.id, issued.invitation);

    const auditEvent = recordAuditEvent({
      organizationId: issued.invitation.organizationId,
      actorUserId: input.actor.actorUserId,
      actorOrganizationId: input.actor.organizationId,
      action: "invitation.issue",
      targetType: "Invitation",
      targetId: issued.invitation.id,
      metadata: { invitedEmail: issued.invitation.invitedEmail, role: issued.invitation.role },
      now: input.now,
    });
    this.auditEvents.push(auditEvent);

    return issued;
  }

  /**
   * Wraps invitations.ts's `revokeInvitation`, looking the Invitation up by
   * `args.invitationId` first (invitations.ts itself has no repository, so
   * it takes the record directly - this is the wiring a future checkpoint's
   * repository layer was expected to add per that file's header). Denial
   * (`AuthorizationDeniedError`, thrown by `revokeInvitation` via B2's
   * `assertIsPlatformAdmin` for any non-ops actor) propagates as-is and, by
   * design, records no AuditEvent - a denied action leaves no
   * "we did the thing" audit trail. On success, additionally calls
   * audit.ts's `recordAuditEvent` to append an "invitation.revoke"
   * AuditEvent scoped to the invitation's organization.
   */
  revokeAndRecordInvitation(args: RevokeInvitationArgs): Invitation {
    const existing = this.invitationsById.get(args.invitationId);
    if (existing === undefined) {
      throw new InvitationNotFoundError(args.invitationId);
    }

    const revoked = revokeInvitation(existing, args);
    this.invitationsById.set(revoked.id, revoked);

    const auditEvent = recordAuditEvent({
      organizationId: revoked.organizationId,
      actorUserId: args.actor.actorUserId,
      actorOrganizationId: args.actor.organizationId,
      action: "invitation.revoke",
      targetType: "Invitation",
      targetId: revoked.id,
      metadata: null,
      now: args.now,
    });
    this.auditEvents.push(auditEvent);

    return revoked;
  }

  getInvitation(invitationId: string): Invitation | undefined {
    return this.invitationsById.get(invitationId);
  }

  /** Returns the AuditEvent rows recorded against `organizationId`, sorted by createdAt ascending. */
  listAudit(organizationId: string): AuditEvent[] {
    return this.auditEvents
      .filter((event) => event.organizationId === organizationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
