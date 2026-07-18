/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
 *   docs/governance/SYSTEM_INVARIANTS_V1.md, and the 7 recovered partial-source
 *   files under recovered/partial-source/ (tenancyRepository usage patterns:
 *   listOrganizations, listAudit, revokeInvitation).
 * reconstruction_reason: no original entity/type definitions were recoverable
 *   from E:\GEO_RECOVERY_SAFE (0/117 recovered commit root trees resolve).
 * original_file_unavailable: true
 *
 * B1-CORRECTION: widened ClientReviewDecision/Membership/Session/
 * AuthorizationContext/AuditEvent/ArtifactIndex per overnight-loop review,
 * and replaced REJECTED with CHANGES_REQUESTED on ClientReviewDecision
 * (a client rejecting a keyword/direction/source is asking for changes,
 * not vetoing the project outright — REJECTED reads as a terminal state
 * this workflow doesn't have). B1's original commit is left in history
 * unrewritten; this file is the corrected state as of B1-CORRECTION.
 */

export type OrganizationType = "PLATFORM" | "AGENCY" | "CLIENT";

export type OrganizationStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export type PlatformRole =
  | "PLATFORM_SUPER_ADMIN"
  | "AGENCY_OWNER"
  | "AGENCY_OPERATOR"
  | "CLIENT_OWNER";

export interface Organization {
  id: string;
  type: OrganizationType;
  displayName: string;
  status: OrganizationStatus;
  /**
   * Idempotency key for creation requests. Display name is deliberately
   * NOT the uniqueness key (SYSTEM_INVARIANTS_V1.md: "Display names must
   * not be used as a unique key").
   */
  idempotencyKey: string;
  /**
   * Prepared for a future stronger identity contract: when an organization
   * originates from an external system (e.g. a migrated agency roster),
   * (sourceNamespace, externalReference) should be the real unique key,
   * with idempotencyKey covering purely-internal creation requests.
   * Neither is enforced yet at this checkpoint - fields only.
   */
  sourceNamespace: string | null;
  externalReference: string | null;
  createdAt: string;
  createdByUserId: string;
}

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: PlatformRole;
  status: MembershipStatus;
  /**
   * Invariant (SYSTEM_INVARIANTS_V1.md): a CLIENT user may belong to at
   * most one ACTIVE CLIENT-type Organization at a time. Enforcement lives
   * in the AuthorizationContext service, not just this shape.
   */
  createdAt: string;
}

/**
 * Acceptance-phase canonicalization: named (not inline) so the frontend's
 * agency/ops assignment-status view-models can import this instead of
 * redeclaring an equivalent "ACTIVE" | "REVOKED" union under a local name
 * (see docs/acceptance/CANONICAL_CONTRACT_UNIFICATION.md).
 */
export type AgencyClientAssignmentStatus = "ACTIVE" | "REVOKED";

/**
 * Explicit, non-implicit grant of an AGENCY organization over a specific
 * CLIENT organization. Existence of a row is the only thing that grants
 * access — no wildcard/implicit agency access is permitted.
 */
export interface AgencyClientAssignment {
  id: string;
  agencyOrganizationId: string;
  clientOrganizationId: string;
  status: AgencyClientAssignmentStatus;
  assignedByUserId: string;
  assignedAt: string;
  revokedAt: string | null;
}

export interface Project {
  id: string;
  clientOrganizationId: string;
  name: string;
  createdAt: string;
  createdByUserId: string;
}

export interface ProjectMembership {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Invitation {
  id: string;
  organizationId: string;
  invitedEmail: string;
  role: PlatformRole;
  status: InvitationStatus;
  /** Never the raw token itself — see docs/rebuild/SECURITY_IMPORT_REPORT.md. */
  tokenHash: string;
  createdByUserId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

export interface Session {
  id: string;
  userId: string;
  membershipId: string;
  organizationId: string;
  role: PlatformRole;
  /** Snapshot of the CLIENT_OWNER's single ACTIVE client org at session-issue time. */
  activeClientOrganizationId: string | null;
  activeProjectId: string | null;
  /**
   * Incremented whenever the underlying membership/role/assignment set
   * changes, so a still-valid-looking session token can be rejected if
   * the authorization facts it was issued against are stale.
   */
  sessionVersion: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

/**
 * Resolved, server-side authorization context for a single request.
 * Route handlers must derive access decisions from this, never from
 * client-supplied organization/project IDs alone — "front-end hiding
 * a control is not a substitute for backend permission verification"
 * (SYSTEM_INVARIANTS_V1.md).
 */
export interface AuthorizationContext {
  actorUserId: string;
  actorRole: PlatformRole;
  organizationId: string;
  organizationType: OrganizationType;
  activeProjectId: string | null;
  /** Populated only for CLIENT_OWNER: the single ACTIVE client org, if any. */
  activeClientOrganizationId: string | null;
  /** Populated only for AGENCY roles: orgs with an ACTIVE assignment row. */
  assignedClientOrganizationIds: string[];
  /** Same set, named for the "which clients may this request touch" check-site. */
  allowedClientOrganizationIds: string[];
  isPlatformAdmin: boolean;
  permissions: string[];
}

export type ClientReviewDecisionValue = "CONFIRMED" | "CHANGES_REQUESTED" | "DEFERRED";

export interface ClientReviewDecision {
  id: string;
  projectId: string;
  subjectType: "KEYWORD" | "CONTENT_DIRECTION" | "SOURCE_TYPE";
  subjectId: string;
  decision: ClientReviewDecisionValue;
  reviewerRole: PlatformRole;
  actingOrganizationId: string;
  targetVersion: number;
  comment: string | null;
  /** Hash of (subjectId, targetVersion, decision, comment) - tamper-evidence for the decision record. */
  decisionHash: string;
  decidedByUserId: string;
  decidedAt: string;
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorUserId: string;
  actorOrganizationId: string;
  clientOrganizationId: string | null;
  projectId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  /** Hash of (action, targetType, targetId, actorUserId, createdAt) for tamper-evidence. */
  eventHash: string;
  createdAt: string;
}

/**
 * Immutable index over historical artifacts (article drafts, evidence
 * seals, etc.). Append-only: SYSTEM_INVARIANTS_V1.md forbids modifying
 * historical business artifacts.
 */
export interface ArtifactIndex {
  id: string;
  artifactType: string;
  artifactId: string;
  clientOrganizationId: string;
  projectId: string;
  artifactVersion: number;
  storagePath: string;
  sealedAt: string;
  createdAt: string;
  contentHash: string;
}
