/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: CORE_RUNTIME_TRUE_PARALLEL — checkpoint ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 *   Lane-local composition of the account/auth runtime: it builds the concrete adapters that
 *   satisfy the C1 AuthServiceDeps ports (ports.ts) by delegating to the real Postgres
 *   repositories (repository-factory.ts), constructs the AuthService, and provides the two
 *   request-layer helpers the App Router routes need — cookie->AuthenticatedSession resolution
 *   and AuditIntent persistence. This is deliberately NOT src/composition (Agent A owns that);
 *   it is the auth lane's own wiring so its routes can be mounted and tested against a real DB.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * Design notes:
 *  - Authorization facts are re-derived server-side from the persisted Session + Organization,
 *    never trusted from the cookie beyond "which user is this". The cookie only identifies the
 *    principal; role / org / assignments come from the database (SYSTEM_INVARIANTS_V1).
 *  - The SessionStore adapter maps the issued Session entity onto PgSessionRepository's
 *    CreateSessionInput; the DB owns the row id, and resolveSession surfaces that DB id so logout
 *    revokes the real row.
 *  - Cookie-based resolution (SESSION_ROTATION_AND_REVOCATION_V1) re-reads the persisted row for
 *    the cookie's organization and EXPLICITLY rejects it when revoked, expired, idle-timed-out, or
 *    stale (session_version behind the membership's live counter), and when the cookie's role no
 *    longer maps to the session's workspace surface — server-side revocation and staleness that a
 *    still-cryptographically-valid cookie cannot bypass.
 *  - A lazy singleton backs the real routes (createPgDatabase(loadDatabaseConfig()!)). Tests
 *    inject their own runtime pointed at the throwaway test database via __setAuthRuntimeForTests.
 */
import { recordAuditEvent } from "../../contracts/tenancy/audit.js";
import type { PlatformRole, Session } from "../../contracts/tenancy/entities.js";
import { isSessionValid } from "../../contracts/tenancy/sessions.js";
import {
  SESSION_COOKIE_NAME,
  allowedSurfaceForRole,
  decodeSessionCookieWithMeta,
} from "../../lib/session-cookie.js";
import { loadDatabaseConfig } from "../../persistence/config.js";
import type { DatabasePort } from "../../persistence/database-port.js";
import { createPgDatabase } from "../../persistence/pg/pg-database.js";
import {
  createRepositories,
  type Repositories,
} from "../../persistence/repository-factory.js";
import { AuthService } from "./auth-service.js";
import type { AuthenticatedSession, AuthenticatedUser, AuditIntentV1 } from "./auth-service.js";
import type {
  AgencyAssignedClient,
  AgencyClientReader,
  AuthServiceDeps,
  InvitationReader,
  MembershipReader,
  OrganizationReader,
  ProjectReader,
  SessionStore,
} from "./ports.js";

const AGENCY_ROLES: readonly PlatformRole[] = ["AGENCY_OWNER", "AGENCY_OPERATOR"];
function isAgencyRole(role: PlatformRole): boolean {
  return AGENCY_ROLES.includes(role);
}

/**
 * Idle window (SESSION_ROTATION_AND_REVOCATION_V1). The session table has no per-request
 * last-activity column, and this checkpoint may not add a migration, so idle is enforced against
 * the cookie's own signed `issuedAt`: a session whose cookie was issued more than this long ago is
 * rejected even while its absolute TTL has not yet elapsed. This is a fixed cap from issue time
 * (not a sliding window — a sliding window would need a per-request write this schema does not
 * model); it is deliberately shorter than the cookie's absolute TTL (SESSION_TTL_MS = 12h).
 */
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Port adapters over the real Postgres repositories
// ---------------------------------------------------------------------------

class RepoSessionStore implements SessionStore {
  constructor(private readonly repos: Repositories) {}

  async create(session: Session): Promise<void> {
    // The persisted Session entity carries an id issued by the domain layer; the DB assigns its
    // own row id. Cookie resolution re-reads by user, so the DB id is the one that matters later.
    await this.repos.sessions.create({
      userId: session.userId,
      membershipId: session.membershipId,
      organizationId: session.organizationId,
      role: session.role,
      activeClientOrganizationId: session.activeClientOrganizationId,
      activeProjectId: session.activeProjectId,
      sessionVersion: session.sessionVersion,
      expiresAt: session.expiresAt,
    });
  }

  find(sessionId: string): Promise<Session | null> {
    return this.repos.sessions.findById(sessionId);
  }

  async revoke(sessionId: string, _now: Date): Promise<void> {
    await this.repos.sessions.revoke(sessionId);
  }
}

class RepoInvitationReader implements InvitationReader {
  constructor(private readonly repos: Repositories) {}
  findByTokenHash(tokenHash: string) {
    return this.repos.invitations.findByTokenHash(tokenHash);
  }
}

class RepoMembershipReader implements MembershipReader {
  constructor(private readonly repos: Repositories) {}
  listActiveByUser(userId: string) {
    return this.repos.memberships.listActiveByUser(userId);
  }
}

class RepoOrganizationReader implements OrganizationReader {
  constructor(private readonly repos: Repositories) {}
  findById(organizationId: string) {
    return this.repos.organizations.findById(organizationId);
  }
}

class RepoProjectReader implements ProjectReader {
  constructor(private readonly repos: Repositories) {}
  findById(projectId: string) {
    return this.repos.projects.findById(projectId);
  }
  listForClient(clientOrganizationId: string) {
    return this.repos.projects.listForClient(clientOrganizationId);
  }
}

class RepoAgencyClientReader implements AgencyClientReader {
  constructor(private readonly repos: Repositories) {}

  async listActiveClientsForAgency(
    agencyOrganizationId: string,
  ): Promise<readonly AgencyAssignedClient[]> {
    const clientIds = await this.repos.agencyClientAssignments.listActiveClientIds(
      agencyOrganizationId,
    );
    const out: AgencyAssignedClient[] = [];
    for (const clientOrganizationId of clientIds) {
      const org = await this.repos.organizations.findById(clientOrganizationId);
      if (!org) continue;
      out.push({
        clientOrganizationId,
        clientOrganizationName: org.displayName,
        // No client-review model exists in this checkpoint's persistence surface; the port
        // declares this count but nothing computes it yet, so it is reported as 0.
        openReviewCount: 0,
      });
    }
    return out;
  }

  isAgencyAuthorizedForClient(
    agencyOrganizationId: string,
    clientOrganizationId: string,
  ): Promise<boolean> {
    return this.repos.agencyClientAssignments.isAuthorized(
      agencyOrganizationId,
      clientOrganizationId,
    );
  }
}

export function buildAuthServiceDeps(repos: Repositories): AuthServiceDeps {
  return {
    sessions: new RepoSessionStore(repos),
    invitations: new RepoInvitationReader(repos),
    memberships: new RepoMembershipReader(repos),
    organizations: new RepoOrganizationReader(repos),
    agencyClients: new RepoAgencyClientReader(repos),
    projects: new RepoProjectReader(repos),
  };
}

// ---------------------------------------------------------------------------
// Auth runtime (service + request-layer helpers)
// ---------------------------------------------------------------------------

export interface AuthRuntime {
  readonly db: DatabasePort;
  readonly repos: Repositories;
  readonly authService: AuthService;
  /** Resolves the raw Cookie header to a server-derived principal, or null when unauthenticated. */
  resolveSession(cookieHeader: string | null | undefined): Promise<AuthenticatedSession | null>;
  /** Loads the identity + password digest used by the login route; never exposes it in a response. */
  findLoginCredentialByEmail(
    email: string,
  ): Promise<{ readonly user: AuthenticatedUser; readonly passwordHash: string | null } | null>;
  /** Persists every AuditIntent the service emitted, computing each event hash via recordAuditEvent. */
  persistAuditIntents(intents: readonly AuditIntentV1[], now: Date): Promise<void>;
}

export function createAuthRuntime(db: DatabasePort): AuthRuntime {
  const repos = createRepositories(db);
  const deps = buildAuthServiceDeps(repos);
  const authService = new AuthService(deps);

  async function findLoginCredentialByEmail(
    email: string,
  ): Promise<{ readonly user: AuthenticatedUser; readonly passwordHash: string | null } | null> {
    const res = await db.query<{ id: string; email: string; password_hash: string | null }>(
      `SELECT id, email, password_hash FROM "user" WHERE lower(email) = lower($1)`,
      [email],
    );
    const row = res.rows[0];
    return row
      ? {
          user: { id: row.id, email: row.email, displayName: null },
          passwordHash: row.password_hash,
        }
      : null;
  }

  /**
   * Loads the most-recent session row for (user, organization) REGARDLESS of status. Unlike
   * listActiveByUser (which silently filters revoked/expired), this returns the row so the caller
   * can reject it EXPLICITLY — the checkpoint requires the runtime to load the row and reject a
   * revoked/expired/stale one, not merely fail to find it.
   */
  async function loadLatestSessionForUserOrg(
    userId: string,
    organizationId: string,
  ): Promise<Session | null> {
    const res = await db.query<{
      id: string;
      user_id: string;
      membership_id: string;
      organization_id: string;
      role: PlatformRole;
      active_client_organization_id: string | null;
      active_project_id: string | null;
      session_version: number;
      created_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, membership_id, organization_id, role,
              active_client_organization_id, active_project_id, session_version,
              created_at, expires_at, revoked_at
         FROM session
        WHERE user_id = $1 AND organization_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [userId, organizationId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      membershipId: row.membership_id,
      organizationId: row.organization_id,
      role: row.role,
      activeClientOrganizationId: row.active_client_organization_id,
      activeProjectId: row.active_project_id,
      sessionVersion: row.session_version,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    };
  }

  /**
   * The membership's current authorization-facts version = the highest session_version ever issued
   * for it. When the underlying membership/role/assignment set changes, the system issues a new,
   * higher-version session; any resolved session behind this high-water mark is stale. There is no
   * membership.session_version column and this checkpoint may not add a migration, so the session
   * table itself is the source of truth for the live counter.
   */
  async function currentMembershipVersion(membershipId: string): Promise<number> {
    const res = await db.query<{ v: number }>(
      `SELECT COALESCE(MAX(session_version), 0)::int AS v FROM session WHERE membership_id = $1`,
      [membershipId],
    );
    return res.rows[0]?.v ?? 0;
  }

  async function resolveSession(
    cookieHeader: string | null | undefined,
  ): Promise<AuthenticatedSession | null> {
    // Signature + absolute-TTL are verified here (CURRENT or PREVIOUS key); the signed issuedAt is
    // the trustworthy input for the idle check below.
    const decoded = decodeSessionCookieWithMeta(readCookie(cookieHeader, SESSION_COOKIE_NAME));
    if (!decoded) return null;
    const { payload, issuedAt } = decoded;

    const now = new Date();

    // Idle-TTL: reject a still-signed cookie whose issue time is older than the idle window, even
    // when its absolute TTL has not yet elapsed.
    if (now.getTime() - issuedAt > SESSION_IDLE_TTL_MS) return null;

    // Load the server-side session row for exactly the organization the cookie claims. A cookie
    // presented for an organization the user has no session in (cross-organization) finds no row.
    const session = await loadLatestSessionForUserOrg(payload.actorUserId, payload.organizationId);
    if (!session) return null;

    // Server-side revocation + expiry + staleness, re-checked against the loaded row: reject if
    // revoked_at is set, expires_at has passed, or session_version is behind the live counter.
    const liveVersion = await currentMembershipVersion(session.membershipId);
    if (!isSessionValid(session, { membershipId: session.membershipId, sessionVersion: liveVersion }, now)) {
      return null;
    }

    // Cross-surface guard: the cookie's asserted role must map to the same workspace surface as the
    // server session's role. A validly-signed cookie whose role no longer matches (e.g. issued
    // before a role change) is rejected rather than trusted.
    if (allowedSurfaceForRole(payload.role) !== allowedSurfaceForRole(session.role)) return null;

    const org = await repos.organizations.findById(session.organizationId);
    if (!org) return null;

    const role = session.role;
    const assignedClientOrganizationIds = isAgencyRole(role)
      ? (await deps.agencyClients.listActiveClientsForAgency(session.organizationId)).map(
          (c) => c.clientOrganizationId,
        )
      : [];

    const user = await db.query<{ email: string }>(
      `SELECT email FROM "user" WHERE id = $1`,
      [session.userId],
    );

    return {
      sessionId: session.id,
      userId: session.userId,
      email: user.rows[0]?.email ?? "",
      displayName: null,
      role,
      organizationId: session.organizationId,
      organizationType: org.type,
      activeClientOrganizationId: session.activeClientOrganizationId,
      assignedClientOrganizationIds,
      actingClientOrganizationId: null,
    };
  }

  async function persistAuditIntents(
    intents: readonly AuditIntentV1[],
    now: Date,
  ): Promise<void> {
    for (const intent of intents) {
      // The audit_event schema has no dedicated outcome column, so the ALLOWED/DENIED verdict is
      // preserved inside the metadata bag (which is part of the hashed/persisted record).
      const metadata: Record<string, unknown> = { ...(intent.metadata ?? {}), outcome: intent.outcome };
      const event = recordAuditEvent({
        organizationId: intent.actorOrganizationId,
        actorUserId: intent.actorUserId,
        actorOrganizationId: intent.actorOrganizationId,
        clientOrganizationId: intent.clientOrganizationId,
        projectId: intent.projectId,
        action: intent.action,
        targetType: intent.targetType,
        targetId: intent.targetId,
        metadata,
        now,
      });
      await repos.auditEvents.append({
        organizationId: event.organizationId,
        actorUserId: event.actorUserId,
        actorOrganizationId: event.actorOrganizationId,
        clientOrganizationId: event.clientOrganizationId,
        projectId: event.projectId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata,
        eventHash: event.eventHash,
      });
    }
  }

  return {
    db,
    repos,
    authService,
    resolveSession,
    findLoginCredentialByEmail,
    persistAuditIntents,
  };
}

// ---------------------------------------------------------------------------
// Lazy singleton for the real routes + a test seam
// ---------------------------------------------------------------------------

let runtimeSingleton: AuthRuntime | null = null;

/** The process-wide auth runtime, built once from the runtime database URL. */
export function getAuthRuntime(): AuthRuntime {
  if (!runtimeSingleton) {
    const config = loadDatabaseConfig();
    if (!config) {
      throw new Error(
        "GEO_DATABASE_URL is not configured; cannot build the account/auth runtime.",
      );
    }
    runtimeSingleton = createAuthRuntime(createPgDatabase(config));
  }
  return runtimeSingleton;
}

/** Test seam: point the routes at an injected runtime (e.g. the throwaway test database). */
export function __setAuthRuntimeForTests(runtime: AuthRuntime | null): void {
  runtimeSingleton = runtime;
}

// ---------------------------------------------------------------------------
// Cookie parsing
// ---------------------------------------------------------------------------

/** Reads a single cookie value out of a raw Cookie request header. */
export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}
