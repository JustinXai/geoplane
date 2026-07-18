/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/tenancy/invitations.ts (B4 - issueInvitation,
 *   effectiveInvitationStatus/isInvitationUsable), src/contracts/tenancy/sessions.ts (B4 -
 *   issueSession), src/contracts/tenancy/in-memory-repository.ts (B5 - createMembership,
 *   recordAudit), this phase's spec section 9 ("邀请 Client Owner → Client Owner 登录")
 * reconstruction_reason: net-new acceptance-phase file - section 9's E2E scenario requires
 *   an invitation-accept-then-login step that no B checkpoint built (B4/B5 only issue and
 *   revoke invitations; nothing transitions PENDING -> ACCEPTED or turns an invitation into
 *   a live session). Deliberately placed in src/composition/, not in
 *   src/contracts/tenancy/*.ts, since this phase's section 一 freezes
 *   TENANCY_AUTH_OFFLINE_FOUNDATION_V1 - B's own files are composed, not extended further.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * SCOPE NOTE: InMemoryTenancyRepository (B5) has no method to persist an invitation's
 * status transition (only `issueAndRecordInvitation`/`revokeAndRecordInvitation` exist -
 * there is deliberately no generic "update" path, consistent with B5's append-only design
 * philosophy). "Accepting" an invitation is therefore modeled here as its real-world
 * business effect - a new Membership is created, and a Session is issued for it - rather
 * than as a stored status mutation on the Invitation record itself. The invitation's
 * usability is still genuinely checked first via B4's `isInvitationUsable` (an
 * expired-but-still-PENDING-status invitation is correctly rejected, per B4's own
 * discipline), so this is not a bypass of B4's invitation-lifecycle logic - it is what
 * happens after that check passes, using the persistence surface B5 actually offers.
 */
import { randomUUID } from "node:crypto";
import type { AuthorizationContext, Invitation, Membership, Organization, Session } from "../contracts/tenancy/entities.js";
import { isInvitationUsable } from "../contracts/tenancy/invitations.js";
import { issueSession } from "../contracts/tenancy/sessions.js";
import type { InMemoryTenancyRepository } from "../contracts/tenancy/in-memory-repository.js";

export interface AcceptInvitationResult {
  membership: Membership;
  session: Session;
  actor: AuthorizationContext;
}

/**
 * "邀请 Client Owner → Client Owner 登录" (invite Client Owner -> Client Owner logs in),
 * modeled end-to-end: checks the invitation is genuinely usable (B4's own expiry/status
 * logic, not re-derived here), creates the real Membership it grants (B5's
 * `createMembership`, which enforces the one-active-client-org invariant exactly as it
 * does for any other membership), issues a real Session for it (B4's `issueSession`), and
 * records an audit event for the acceptance. Throws if the invitation is not currently
 * usable - never silently treats an expired/revoked invitation as accepted.
 */
export function acceptInvitationAndLogIn(
  tenancyRepository: InMemoryTenancyRepository,
  invitation: Invitation,
  organization: Organization,
  acceptingUserId: string,
  now: Date,
): AcceptInvitationResult {
  if (!isInvitationUsable(invitation, now)) {
    throw new Error(
      `acceptInvitationAndLogIn: invitation "${invitation.id}" is not usable (status/expiry check failed).`,
    );
  }
  if (invitation.organizationId !== organization.id) {
    throw new Error(
      `acceptInvitationAndLogIn: invitation "${invitation.id}" targets organization ` +
        `"${invitation.organizationId}", not the given organization "${organization.id}".`,
    );
  }

  const membership = tenancyRepository.createMembership({
    userId: acceptingUserId,
    organizationId: organization.id,
    role: invitation.role,
    now,
  });

  const isClientOwner = organization.type === "CLIENT" && invitation.role === "CLIENT_OWNER";
  const actor: AuthorizationContext = {
    actorUserId: acceptingUserId,
    actorRole: invitation.role,
    organizationId: organization.id,
    organizationType: organization.type,
    activeProjectId: null,
    activeClientOrganizationId: isClientOwner ? organization.id : null,
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: invitation.role === "PLATFORM_SUPER_ADMIN",
    permissions: [],
  };

  const session = issueSession(
    membership,
    { membershipId: membership.id, sessionVersion: 0 },
    actor,
    { id: randomUUID(), now },
  );

  tenancyRepository.recordAudit({
    organizationId: organization.id,
    actorUserId: acceptingUserId,
    actorOrganizationId: organization.id,
    action: "invitation.accepted",
    targetType: "Invitation",
    targetId: invitation.id,
    metadata: { membershipId: membership.id, sessionId: session.id },
    now,
  });

  return { membership, session, actor };
}
