/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 checkpoint B2 —
 *   the Repository composition factory + transaction boundary. Bundles every persistence
 *   repository behind one object so the composition root (Agent A) wires the whole app once,
 *   and gives callers an atomic multi-repository unit via withRepositories(tx).
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type { DatabasePort, Queryable } from "./database-port.js";
import { PgAgencyClientAssignmentRepository } from "./pg/agency-client-assignment-repository.js";
import { PgArtifactIndexRepository } from "./pg/artifact-index-repository.js";
import { PgAuditEventRepository } from "./pg/audit-event-repository.js";
import { PgInvitationRepository } from "./pg/invitation-repository.js";
import { PgMembershipRepository } from "./pg/membership-repository.js";
import { PgOrganizationRepository } from "./pg/organization-repository.js";
import { PgProjectRepository } from "./pg/project-repository.js";
import { PgSessionRepository } from "./pg/session-repository.js";

export interface Repositories {
  readonly organizations: PgOrganizationRepository;
  readonly memberships: PgMembershipRepository;
  readonly agencyClientAssignments: PgAgencyClientAssignmentRepository;
  readonly projects: PgProjectRepository;
  readonly invitations: PgInvitationRepository;
  readonly sessions: PgSessionRepository;
  readonly auditEvents: PgAuditEventRepository;
  readonly artifactIndex: PgArtifactIndexRepository;
}

/** Binds every repository to one Queryable (the pool, or a live transaction handle). */
export function createRepositories(q: Queryable): Repositories {
  return {
    organizations: new PgOrganizationRepository(q),
    memberships: new PgMembershipRepository(q),
    agencyClientAssignments: new PgAgencyClientAssignmentRepository(q),
    projects: new PgProjectRepository(q),
    invitations: new PgInvitationRepository(q),
    sessions: new PgSessionRepository(q),
    auditEvents: new PgAuditEventRepository(q),
    artifactIndex: new PgArtifactIndexRepository(q),
  };
}

/**
 * Runs `work` with a repository set bound to a single transaction — every write inside
 * commits together or rolls back together. This is the atomic boundary for flows that touch
 * more than one repository (e.g. create-org + membership + audit in one unit).
 */
export function withRepositories<T>(
  db: DatabasePort,
  work: (repos: Repositories) => Promise<T>,
): Promise<T> {
  return db.transaction((tx) => work(createRepositories(tx)));
}
