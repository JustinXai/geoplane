/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: CORE_RUNTIME_TRUE_PARALLEL — checkpoint ACCOUNT_AUTH_API_CONTRACT_V1.
 *   Consumer-defined repository ports for the account/auth runtime lane. This lane OWNS these
 *   interfaces (the "consumer defines the port" pattern): it declares exactly the reads/writes
 *   the auth flows in auth-service.ts need, and nothing more. A persistence lane (Agent B) or a
 *   wiring lane (Agent A) supplies concrete adapters; unit tests supply in-memory fakes. Nothing
 *   here imports the pg/database layer, so the whole lane is DB-independent and unit-testable.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * Design rules honoured here:
 *  - Ports are minimal: only the methods the login / logout / getAccount / acceptInvitation /
 *    listAgencyClients / setAgencyContext / getProject flows actually call.
 *  - Ports return/accept only domain entities (src/contracts/tenancy/entities.ts) or small
 *    lane-local aggregate shapes — never presentation DTOs and never raw DB rows.
 *  - Every read is async (Promise-returning) so a real adapter can be backed by a database
 *    without changing the service; the in-memory fakes just resolve synchronously.
 */
import type {
  Invitation,
  Membership,
  Organization,
  Project,
  Session,
} from "../../contracts/tenancy/entities.js";

/**
 * Per-client aggregate the agency-portfolio flow needs but cannot derive from the other ports
 * alone (open-review counts are not modelled by any read this lane declares). The repository
 * that knows about review state is the right place to compute it, so the reader returns it
 * pre-aggregated. Kept lane-local (not the frozen AgencyClientPortfolioItemV1 DTO) so the port
 * stays a domain-facing contract, not a presentation one.
 */
export interface AgencyAssignedClient {
  readonly clientOrganizationId: string;
  readonly clientOrganizationName: string;
  /** Number of client-review items still awaiting a decision for this client. */
  readonly openReviewCount: number;
}

/**
 * Server-side session lifecycle. `create` persists a freshly issued Session; `find` resolves a
 * session id back to its record (used by the route/middleware layer, Agent A's wiring, to
 * validate a request); `revoke` marks a session revoked at `now` (logout).
 */
export interface SessionStore {
  create(session: Session): Promise<void>;
  find(sessionId: string): Promise<Session | null>;
  revoke(sessionId: string, now: Date): Promise<void>;
}

/** Read side of invitations, keyed by the stored token *hash* — never the raw token. */
export interface InvitationReader {
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
}

/** Resolves a user's ACTIVE memberships (SUSPENDED/REMOVED rows must not be returned). */
export interface MembershipReader {
  listActiveByUser(userId: string): Promise<readonly Membership[]>;
}

export interface OrganizationReader {
  findById(organizationId: string): Promise<Organization | null>;
}

/**
 * Agency↔client authorization reads. Both methods answer only from ACTIVE
 * AgencyClientAssignment rows — no wildcard/implicit agency access is ever implied.
 */
export interface AgencyClientReader {
  /** Clients an agency currently has an ACTIVE assignment to, with the counts the portfolio view needs. */
  listActiveClientsForAgency(agencyOrganizationId: string): Promise<readonly AgencyAssignedClient[]>;
  /** True iff an ACTIVE assignment row grants `agencyOrganizationId` access to `clientOrganizationId`. */
  isAgencyAuthorizedForClient(
    agencyOrganizationId: string,
    clientOrganizationId: string,
  ): Promise<boolean>;
}

export interface ProjectReader {
  findById(projectId: string): Promise<Project | null>;
  listForClient(clientOrganizationId: string): Promise<readonly Project[]>;
}

/** The full set of ports the auth service depends on, bundled for construction/wiring. */
export interface AuthServiceDeps {
  readonly sessions: SessionStore;
  readonly invitations: InvitationReader;
  readonly memberships: MembershipReader;
  readonly organizations: OrganizationReader;
  readonly agencyClients: AgencyClientReader;
  readonly projects: ProjectReader;
}
