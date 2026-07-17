/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
 *   docs/governance/SYSTEM_INVARIANTS_V1.md, src/contracts/tenancy/entities.ts
 *   (checkpoint B1/B1-CORRECTION - Invitation shape, incl. tokenHash),
 *   src/contracts/tenancy/authorization.ts (checkpoint B2 - assertIsPlatformAdmin),
 *   migrations/0001_tenancy_foundation.sql (checkpoint B3 - invitation table:
 *   token_hash NOT raw token, the revoked_at + revoked_by_user_id pairing
 *   constraint), and
 *   recovered/partial-source/00040000000C9C455B787075-route.ts - a REAL
 *   recovered file (not spec-only) whose DELETE handler is:
 *     const actor = await requireSurfaceAuthorization("ops");
 *     await tenancyRepository.revokeInvitation({ invitationId: id, actor, now: new Date() });
 *   This is the direct corroborating evidence for revokeInvitation's
 *   `{ invitationId, actor, now }` argument shape and its ops-gated nature
 *   below.
 * reconstruction_reason: no original src/contracts/tenancy/invitations.ts
 *   (or equivalent invitation-issuance/revocation business logic) was
 *   recoverable from E:\GEO_RECOVERY_SAFE. The recovered route file above is
 *   real evidence for the *shape* of revokeInvitation's call site, but the
 *   route itself only forwards to `tenancyRepository.revokeInvitation` -
 *   the repository implementation was not recovered, so the body of
 *   revokeInvitation below (the actual state transition + authorization
 *   gate) is reconstructed from the frozen spec docs, not recovered code.
 * original_file_unavailable: true
 *
 * Checkpoint B4 (part 1/3) - Invitation business logic.
 *
 * Scope note: this module has no repository/database wiring (that is a
 * later checkpoint's concern - B4 covers pure, runnable business logic
 * only). Functions here take and return plain entities.ts values; a future
 * checkpoint is expected to wire a real `tenancyRepository` around these.
 *
 * Token handling: SYSTEM_INVARIANTS_V1.md forbids committing "invitation
 * tokens" as secrets, and entities.ts is explicit that Invitation.tokenHash
 * is "Never the raw token itself". issueInvitation() below therefore never
 * puts the raw token on the returned `Invitation` object - the raw token is
 * returned as a clearly separate `token` field on `IssuedInvitation`, so a
 * caller who naively logs/persists the `invitation` field alone cannot leak
 * it. Callers are responsible for delivering `token` out-of-band (e.g.
 * email) and discarding it immediately after - it is never stored here.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuthorizationContext, Invitation, InvitationStatus, PlatformRole } from "./entities.js";
import { assertIsPlatformAdmin } from "./authorization.js";

/** Default invitation lifetime: 7 days. */
export const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IssueInvitationInput {
  /** Optional caller-supplied id (e.g. for deterministic tests); random UUID otherwise. */
  id?: string;
  organizationId: string;
  invitedEmail: string;
  role: PlatformRole;
  createdByUserId: string;
  now: Date;
  /** Defaults to DEFAULT_INVITATION_TTL_MS. */
  ttlMs?: number;
  /**
   * Optional caller-supplied raw token (e.g. deterministic tests only - see
   * docs/governance/SYSTEM_INVARIANTS_V1.md's "obviously fake values" rule
   * for anything committed while this repo is public). A cryptographically
   * random 32-byte hex token is generated via node:crypto otherwise.
   */
  token?: string;
}

export interface IssuedInvitation {
  /** Persistable record. Carries `tokenHash` only - never the raw token. */
  invitation: Invitation;
  /**
   * The RAW, one-time invitation token. Deliver out-of-band (e.g. email
   * link) and then discard - do not log or persist this value, and do not
   * attach it to the same object/record as `invitation`.
   */
  token: string;
}

/** SHA-256 hex digest of a raw invitation token - the only form ever persisted. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a new PENDING invitation. Generates (or accepts) a raw token and
 * stores only its hash on the returned `invitation`; the raw token is
 * returned as a sibling field (`token`) precisely so it never ends up
 * comingled with the fields that get logged/persisted.
 */
export function issueInvitation(input: IssueInvitationInput): IssuedInvitation {
  const token = input.token ?? randomBytes(32).toString("hex");
  const tokenHash = hashInvitationToken(token);
  const createdAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + (input.ttlMs ?? DEFAULT_INVITATION_TTL_MS)).toISOString();

  const invitation: Invitation = {
    id: input.id ?? randomUUID(),
    organizationId: input.organizationId,
    invitedEmail: input.invitedEmail,
    role: input.role,
    status: "PENDING",
    tokenHash,
    createdByUserId: input.createdByUserId,
    createdAt,
    expiresAt,
    revokedAt: null,
    revokedByUserId: null,
  };

  return { invitation, token };
}

/**
 * Reconstructs the recovered `requireSurfaceAuthorization("ops")` gate seen
 * in 00040000000C9C455B787075-route.ts. src/contracts/tenancy/authorization.ts
 * (B2) has no separate "ops role" concept - only `isPlatformAdmin` /
 * `PLATFORM_SUPER_ADMIN` - so this is deliberately conservative: the ops
 * surface is reconstructed as platform-admin-only. That is a strict subset
 * of any plausible original "ops" definition, so this cannot accidentally
 * be more permissive than the lost original, and it trivially satisfies the
 * frozen-spec requirement that a CLIENT_OWNER (or any non-platform-admin
 * role) can never revoke invitations for an organization it does not
 * administer - no such role is ever ops-authorized here, regardless of
 * which organization it targets.
 */
function assertOpsSurfaceAuthorized(actor: AuthorizationContext): void {
  assertIsPlatformAdmin(actor);
}

export interface RevokeInvitationArgs {
  /** Mirrors the recovered route's `{ invitationId, actor, now }` shape. */
  invitationId: string;
  actor: AuthorizationContext;
  now: Date;
}

/**
 * Revokes an invitation. Mirrors the recovered
 * `tenancyRepository.revokeInvitation({ invitationId, actor, now })` call
 * shape; since this module has no repository, the invitation record itself
 * is passed in as the first argument (a future checkpoint's repository
 * layer is expected to look it up by `args.invitationId` before calling
 * this).
 *
 * Gated by `assertOpsSurfaceAuthorized` (see above) - throws
 * `AuthorizationDeniedError` (from authorization.ts) for any non-ops actor,
 * including a CLIENT_OWNER, regardless of which organization they claim to
 * administer.
 */
export function revokeInvitation(invitation: Invitation, args: RevokeInvitationArgs): Invitation {
  if (invitation.id !== args.invitationId) {
    throw new Error(
      `revokeInvitation: invitation.id (${invitation.id}) does not match requested invitationId (${args.invitationId}).`,
    );
  }

  assertOpsSurfaceAuthorized(args.actor);

  if (invitation.status === "REVOKED") {
    // Idempotent: revoking an already-revoked invitation is a no-op, not an error.
    return invitation;
  }

  return {
    ...invitation,
    status: "REVOKED",
    revokedAt: args.now.toISOString(),
    revokedByUserId: args.actor.actorUserId,
  };
}

/**
 * Computes the invitation's *effective* status as of `now`, without
 * mutating or trusting the stored `status` column alone: a PENDING
 * invitation whose `expiresAt` has passed is EXPIRED even if a background
 * job has not yet written that back to storage. REVOKED/ACCEPTED are
 * terminal and are returned as-is (expiry is meaningless once an invitation
 * has already left the PENDING state some other way).
 */
export function effectiveInvitationStatus(invitation: Invitation, now: Date): InvitationStatus {
  if (invitation.status === "PENDING" && new Date(invitation.expiresAt).getTime() <= now.getTime()) {
    return "EXPIRED";
  }
  return invitation.status;
}

/**
 * "Is this invitation currently usable (i.e. acceptable)" - computed from
 * both `status` and `expiresAt`, per SYSTEM_INVARIANTS_V1.md-derived
 * requirement that a stale PENDING row with a past `expiresAt` must not be
 * trusted just because no background job has flipped its status yet.
 */
export function isInvitationUsable(invitation: Invitation, now: Date): boolean {
  return effectiveInvitationStatus(invitation, now) === "PENDING";
}
