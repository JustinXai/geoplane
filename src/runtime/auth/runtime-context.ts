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
 *    CreateSessionInput; the DB owns the row id. Cookie-based resolution re-reads the persisted
 *    row (listActiveByUser, which already filters revoked/expired), so logout revokes the real id.
 *  - A lazy singleton backs the real routes (createPgDatabase(loadDatabaseConfig()!)). Tests
 *    inject their own runtime pointed at the throwaway test database via __setAuthRuntimeForTests.
 */
import { recordAuditEvent } from "../../contracts/tenancy/audit.js";
import type { PlatformRole, Session } from "../../contracts/tenancy/entities.js";
import {
  SESSION_COOKIE_NAME,
  decodeSessionCookie,
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
  /** Looks up an already-verified user by email (credential verification is out of scope). */
  findUserByEmail(email: string): Promise<AuthenticatedUser | null>;
  /** Persists every AuditIntent the service emitted, computing each event hash via recordAuditEvent. */
  persistAuditIntents(intents: readonly AuditIntentV1[], now: Date): Promise<void>;
}

export function createAuthRuntime(db: DatabasePort): AuthRuntime {
  const repos = createRepositories(db);
  const deps = buildAuthServiceDeps(repos);
  const authService = new AuthService(deps);

  async function findUserByEmail(email: string): Promise<AuthenticatedUser | null> {
    const res = await db.query<{ id: string; email: string }>(
      `SELECT id, email FROM "user" WHERE lower(email) = lower($1)`,
      [email],
    );
    const row = res.rows[0];
    return row ? { id: row.id, email: row.email, displayName: null } : null;
  }

  async function resolveSession(
    cookieHeader: string | null | undefined,
  ): Promise<AuthenticatedSession | null> {
    const payload = decodeSessionCookie(readCookie(cookieHeader, SESSION_COOKIE_NAME));
    if (!payload) return null;

    // Validity (not revoked, not expired) is enforced by the query; take the newest valid row.
    const sessions = await repos.sessions.listActiveByUser(payload.actorUserId);
    const session = sessions[0];
    if (!session) return null;

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

  return { db, repos, authService, resolveSession, findUserByEmail, persistAuditIntents };
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
