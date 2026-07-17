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
 * This file defines type-level contracts only. There is no package.json,
 * tsconfig, or build pipeline yet (see docs/rebuild/RECOVERY_GAP_ANALYSIS.md,
 * P0 gap) — this is not compiled or typechecked as part of this checkpoint.
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
  creationIdempotencyKey: string;
  createdAt: string;
  createdByUserId: string;
}

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: PlatformRole;
  /**
   * Invariant (SYSTEM_INVARIANTS_V1.md): a CLIENT user may belong to at
   * most one ACTIVE CLIENT-type Organization at a time. Enforcement lives
   * in the AuthorizationContext service, not just this shape.
   */
  createdAt: string;
}

/**
 * Explicit, non-implicit grant of an AGENCY organization over a specific
 * CLIENT organization. Existence of a row is the only thing that grants
 * access — no wildcard/implicit agency access is permitted.
 */
export interface AgencyClientAssignment {
  id: string;
  agencyOrganizationId: string;
  clientOrganizationId: string;
  status: "ACTIVE" | "REVOKED";
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
  /** Populated only for CLIENT_OWNER: the single ACTIVE client org, if any. */
  activeClientOrganizationId: string | null;
  /** Populated only for AGENCY roles: orgs with an ACTIVE assignment row. */
  assignedClientOrganizationIds: string[];
  isPlatformAdmin: boolean;
}

export interface ClientReviewDecision {
  id: string;
  projectId: string;
  subjectType: "KEYWORD" | "CONTENT_DIRECTION" | "SOURCE_TYPE";
  subjectId: string;
  decision: "CONFIRMED" | "REJECTED";
  decidedByUserId: string;
  decidedAt: string;
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
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
  sealedAt: string;
  contentHash: string;
}
