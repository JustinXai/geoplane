/**
 * Lane-local command-result DTOs for BUSINESS_COMMAND_API_V1 (Agent C — batch 1).
 *
 * The FROZEN cross-lane contract (src/runtime/api-contracts/index.ts) is owned by Agent A and
 * carries only the presentation READ view-models the frontend consumes (ProjectViewV1,
 * AuditEventViewV1, …). It has no view-model for the *write* results this checkpoint produces
 * (a newly-created organization / assignment / invitation), and this lane may not modify that
 * frozen file. These DTOs are therefore declared here, in the command lane's own directory, as
 * the canonical envelopes for command responses.
 *
 * Client-surface safety (SYSTEM_INVARIANTS_V1.md): these are view-models — stable ids and
 * human-facing fields only. In particular InvitationViewV1 deliberately NEVER carries the
 * invitation token or its hash (only the hash is persisted; neither is ever returned).
 */
import type {
  AgencyClientAssignmentStatus,
  InvitationStatus,
  OrganizationStatus,
  OrganizationType,
  PlatformRole,
} from "../../contracts/tenancy/entities.js";

/** A newly-created (or listed) organization, as a client-safe summary. */
export interface OrganizationSummaryV1 {
  readonly id: string;
  readonly type: OrganizationType;
  readonly displayName: string;
  readonly status: OrganizationStatus;
  readonly createdAt: string;
}

/** A newly-created agency<->client assignment. */
export interface AgencyClientAssignmentViewV1 {
  readonly id: string;
  readonly agencyOrganizationId: string;
  readonly clientOrganizationId: string;
  readonly status: AgencyClientAssignmentStatus;
  readonly assignedAt: string;
}

/**
 * The result of an agency provisioning a client it will manage: the new CLIENT organization plus
 * the ACTIVE assignment row that grants the agency access to it.
 */
export interface AgencyClientProvisionViewV1 {
  readonly client: OrganizationSummaryV1;
  readonly assignment: AgencyClientAssignmentViewV1;
}

/**
 * A PENDING invitation. Carries no token material of any kind — the raw token is delivered
 * out-of-band by the caller and only its SHA-256 hash is ever persisted.
 */
export interface InvitationViewV1 {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly invitedEmail: string;
  readonly role: PlatformRole;
  readonly status: InvitationStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
}
