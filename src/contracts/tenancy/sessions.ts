/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
 *   docs/governance/SYSTEM_INVARIANTS_V1.md, src/contracts/tenancy/entities.ts
 *   (checkpoint B1/B1-CORRECTION - Session shape, incl. sessionVersion and
 *   the "snapshot of the CLIENT_OWNER's single ACTIVE client org at
 *   session-issue time" comment), src/contracts/tenancy/authorization.ts
 *   (checkpoint B2 - AuthorizationContext), migrations/0001_tenancy_foundation.sql
 *   (checkpoint B3 - session table, session_version column and its comment:
 *   "Incremented whenever the underlying membership/role/assignment set
 *   changes, so a still-valid-looking session token can be rejected if the
 *   authorization facts it was issued against are stale.").
 * reconstruction_reason: no original session-issuance/validation business
 *   logic was recoverable from E:\GEO_RECOVERY_SAFE. None of the 7 recovered
 *   partial-source files touch session issuance/validation directly (they
 *   corroborate the invitation/audit/organization surfaces, not sessions),
 *   so this file has no recovered-code corroboration - it is reconstructed
 *   from the frozen spec/entity comments alone.
 * original_file_unavailable: true
 *
 * Checkpoint B4 (part 2/3) - Session business logic.
 *
 * Scope note: no repository/database wiring here (see invitations.ts's
 * equivalent note) - pure, runnable business logic over entities.ts values.
 *
 * sessionVersion staleness: entities.ts models `sessionVersion` only as a
 * snapshot on `Session` (the value at issue time) - `Membership` (B1) has no
 * live `sessionVersion` field of its own to compare against, and B1/B1-
 * CORRECTION are out of scope for this checkpoint (not to be redefined
 * here). `CurrentMembershipSessionVersion` below is the minimal
 * supplementary carrier this checkpoint needs for "what is the membership's
 * live session-version counter right now" - conceptually the same counter
 * `session.session_version` snapshots in migrations/0001_tenancy_foundation.sql,
 * just not (yet) modeled as a persisted Membership column in entities.ts.
 * A future checkpoint that adds a live sessionVersion field to Membership
 * itself could retire this type in favor of passing a Membership directly.
 */
import { randomUUID } from "node:crypto";
import type { AuthorizationContext, Membership, Session } from "./entities.js";

/** Default session lifetime: 24 hours. */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface IssueSessionInput {
  /** Optional caller-supplied id (e.g. for deterministic tests); random UUID otherwise. */
  id?: string;
  now: Date;
  /** Defaults to DEFAULT_SESSION_TTL_MS. */
  ttlMs?: number;
}

/**
 * Issues a Session snapshot from a resolved Membership + AuthorizationContext.
 * `role` / `activeClientOrganizationId` / `activeProjectId` are copied from
 * `ctx` (the server-resolved authorization facts for this login), never
 * re-derived from client input, per authorization.ts's rule that route
 * handlers must derive access decisions from a server-resolved context.
 *
 * `sessionVersion` is snapshotted from `membership.sessionVersion` at issue
 * time (see the module doc above for why that field lives on
 * `CurrentMembershipSessionVersion` rather than the B1 `Membership` type).
 */
export function issueSession(
  membership: Membership,
  currentVersion: CurrentMembershipSessionVersion,
  ctx: AuthorizationContext,
  input: IssueSessionInput,
): Session {
  if (membership.id !== currentVersion.membershipId) {
    throw new Error(
      `issueSession: membership.id (${membership.id}) does not match currentVersion.membershipId (${currentVersion.membershipId}).`,
    );
  }
  if (membership.userId !== ctx.actorUserId) {
    throw new Error(
      `issueSession: membership.userId (${membership.userId}) does not match ctx.actorUserId (${ctx.actorUserId}).`,
    );
  }

  const createdAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + (input.ttlMs ?? DEFAULT_SESSION_TTL_MS)).toISOString();

  return {
    id: input.id ?? randomUUID(),
    userId: membership.userId,
    membershipId: membership.id,
    organizationId: membership.organizationId,
    role: ctx.actorRole,
    activeClientOrganizationId: ctx.activeClientOrganizationId,
    activeProjectId: ctx.activeProjectId,
    sessionVersion: currentVersion.sessionVersion,
    createdAt,
    expiresAt,
    revokedAt: null,
  };
}

/**
 * "As of right now, membership X's live session-version counter is N." See
 * the module doc above for why this is a supplementary B4 type rather than
 * a field added to the B1 `Membership` entity.
 */
export interface CurrentMembershipSessionVersion {
  membershipId: string;
  sessionVersion: number;
}

/**
 * True iff `session` was issued at-or-after the membership's current
 * sessionVersion. A session issued against sessionVersion=1 is rejected
 * once the live membership's version has since incremented (e.g. a role
 * change, membership suspension, or assignment change bumped it to 2) -
 * this is the staleness-detection mechanism entities.ts/migration 0001
 * describe for Session.sessionVersion.
 */
export function isSessionVersionCurrent(session: Session, current: CurrentMembershipSessionVersion): boolean {
  if (session.membershipId !== current.membershipId) {
    throw new Error(
      `isSessionVersionCurrent: session.membershipId (${session.membershipId}) does not match current.membershipId (${current.membershipId}).`,
    );
  }
  return session.sessionVersion >= current.sessionVersion;
}

/**
 * Full session-validity check: not revoked, not expired, and not stale
 * against the membership's current sessionVersion. This is the function
 * route/session middleware should call - `isSessionVersionCurrent` alone
 * only covers the staleness half.
 */
export function isSessionValid(session: Session, current: CurrentMembershipSessionVersion, now: Date): boolean {
  if (session.revokedAt !== null) {
    return false;
  }
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    return false;
  }
  return isSessionVersionCurrent(session, current);
}
