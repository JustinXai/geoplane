/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: CORE_RUNTIME_TRUE_PARALLEL — checkpoint ACCOUNT_AUTH_API_CONTRACT_V1.
 *   Framework-agnostic account/auth business logic. Every function is pure over its inputs plus
 *   the injected ports (ports.ts): no Next.js, no direct DB, no global state. That makes the
 *   whole lane unit-testable against in-memory fakes and lets a route/wiring lane (Agent A) mount
 *   these behind real HTTP + a real persistence adapter in the next checkpoint without touching
 *   the rules encoded here.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * Invariants enforced (SYSTEM_INVARIANTS_V1 / authorization.ts):
 *  - A CLIENT_OWNER is pinned to their single ACTIVE client organization and can NEVER switch to
 *    another client org — activeClientOrganizationId is fixed at login for the life of the session.
 *  - An AGENCY role may act only for a client it has an ACTIVE assignment to; selecting any other
 *    client is FORBIDDEN and emits an audit intent.
 *  - Cross-tenant access (reading another tenant's project) is FORBIDDEN and emits an audit intent.
 *  - Front-end hiding is never trusted: authorization is re-derived server-side from the resolved
 *    session, never from a caller-supplied organization/client id alone.
 */
import {
  apiErr,
  apiOk,
  type AccountViewV1,
  type AgencyClientPortfolioItemV1,
  type AgencyClientPortfolioViewV1,
  type ApiResponseV1,
  type ProjectViewV1,
  type WorkspaceSurfaceV1,
} from "../api-contracts/index.js";
import {
  canAccessClientOrganization,
} from "../../contracts/tenancy/authorization.js";
import type {
  AuthorizationContext,
  Organization,
  OrganizationType,
  PlatformRole,
} from "../../contracts/tenancy/entities.js";
import {
  effectiveInvitationStatus,
  isInvitationUsable,
} from "../../contracts/tenancy/invitations.js";
import { issueSession } from "../../contracts/tenancy/sessions.js";
import {
  allowedSurfaceForRole,
  encodeSessionCookie,
  SESSION_COOKIE_NAME,
  type AcceptanceSessionCookiePayload,
} from "../../lib/session-cookie.js";
import type { AuthServiceDeps } from "./ports.js";

// ---------------------------------------------------------------------------
// Lane-local runtime types (not frozen DTOs)
// ---------------------------------------------------------------------------

/**
 * The resolved, server-side principal for a single request. Produced by `login` and by the
 * route/middleware layer (Agent A) after validating the session cookie; passed into the read
 * flows below. Distinct from the persisted `Session` entity and from the client-facing
 * AccountViewV1 — it carries the authorization facts (assigned clients, acting client) the
 * service needs but must never ship to a client surface.
 */
export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: PlatformRole;
  readonly organizationId: string;
  readonly organizationType: OrganizationType;
  /** Non-null only for a CLIENT_OWNER: their single fixed ACTIVE client org. */
  readonly activeClientOrganizationId: string | null;
  /** ACTIVE-assigned client orgs (AGENCY roles only); empty otherwise. */
  readonly assignedClientOrganizationIds: readonly string[];
  /** The client an AGENCY has selected to act for this session; null until `setAgencyContext`. */
  readonly actingClientOrganizationId: string | null;
}

/** The already-authenticated identity `login` / `acceptInvitation` operate on (credential
 *  verification itself is out of scope — and deliberately not built here). */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName?: string | null;
}

export interface LoginInput {
  readonly user: AuthenticatedUser;
  readonly now: Date;
  /** Deterministic id for tests; a random UUID is generated otherwise. */
  readonly sessionId?: string;
  /** Live session-version counter to snapshot; defaults to 1. */
  readonly sessionVersion?: number;
  readonly ttlMs?: number;
}

export interface LoginResultV1 {
  readonly account: AccountViewV1;
  /** Resolved principal for subsequent same-request calls (getAccount/getProject/…). */
  readonly session: AuthenticatedSession;
  /** Name of the cookie the route must Set-Cookie. */
  readonly sessionCookieName: string;
  /** Encoded value for that cookie — the exact shape middleware.ts already decodes. */
  readonly sessionCookie: string;
}

export interface AcceptInvitationInput {
  readonly tokenHash: string;
  readonly user: AuthenticatedUser;
  readonly now: Date;
}

export interface AgencyActingContextV1 {
  readonly agencyOrganizationId: string;
  readonly agencyOrganizationName: string;
  readonly actingClientOrganizationId: string;
  readonly actingClientOrganizationName: string;
  readonly surface: WorkspaceSurfaceV1;
}

/**
 * An append-only audit record the service *intends* to emit; the persistence/wiring lane
 * (Agent A) turns it into a real AuditEvent (adding id/hash/createdAt). Mirrors the identifying
 * fields of AuditEvent (entities.ts) without the persistence-owned ones.
 */
export interface AuditIntentV1 {
  readonly action: string;
  readonly outcome: "ALLOWED" | "DENIED";
  readonly actorUserId: string;
  readonly actorOrganizationId: string;
  readonly clientOrganizationId: string | null;
  readonly projectId: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly metadata?: Record<string, unknown>;
}

/** Result of a flow that may emit audit intents regardless of allow/deny outcome. */
export interface AuditedResultV1<T> {
  readonly response: ApiResponseV1<T>;
  readonly auditIntents: readonly AuditIntentV1[];
}

export interface SetAgencyContextResultV1 {
  readonly response: ApiResponseV1<AgencyActingContextV1>;
  /** Updated principal (acting client set) on success; unchanged on failure. */
  readonly session: AuthenticatedSession;
  readonly auditIntents: readonly AuditIntentV1[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENCY_ROLES: readonly PlatformRole[] = ["AGENCY_OWNER", "AGENCY_OPERATOR"];

function isAgencyRole(role: PlatformRole): boolean {
  return AGENCY_ROLES.includes(role);
}

/** Maps a role's route-prefix surface ("app"|"agency"|"ops") to the client-facing WorkspaceSurfaceV1. */
function surfaceForRole(role: PlatformRole): WorkspaceSurfaceV1 {
  const prefix = allowedSurfaceForRole(role);
  return prefix === "app" ? "client" : prefix;
}

/** A CLIENT_OWNER is pinned to their own organization; every other role has no fixed client. */
function pinnedClientOrganizationId(role: PlatformRole, organizationId: string): string | null {
  return role === "CLIENT_OWNER" ? organizationId : null;
}

function buildAccountView(
  user: AuthenticatedUser,
  role: PlatformRole,
  org: Organization,
): AccountViewV1 {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName ?? null,
    role,
    surface: surfaceForRole(role),
    organizationId: org.id,
    organizationName: org.displayName,
    organizationType: org.type,
    activeClientOrganizationId: pinnedClientOrganizationId(role, org.id),
  };
}

/**
 * Re-derives an AuthorizationContext from a resolved session so authorization.ts's canonical
 * checks can be reused. Identity/grants come only from the trusted session — never from a
 * caller-supplied id.
 */
function contextFromSession(session: AuthenticatedSession): AuthorizationContext {
  const assigned = [...session.assignedClientOrganizationIds];
  return {
    actorUserId: session.userId,
    actorRole: session.role,
    organizationId: session.organizationId,
    organizationType: session.organizationType,
    activeProjectId: null,
    activeClientOrganizationId:
      session.role === "CLIENT_OWNER" ? session.activeClientOrganizationId : null,
    assignedClientOrganizationIds: assigned,
    allowedClientOrganizationIds: assigned,
    isPlatformAdmin: session.role === "PLATFORM_SUPER_ADMIN",
    permissions: [],
  };
}

function deniedAudit(
  action: string,
  session: AuthenticatedSession,
  fields: {
    clientOrganizationId?: string | null;
    projectId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): AuditIntentV1 {
  return {
    action,
    outcome: "DENIED",
    actorUserId: session.userId,
    actorOrganizationId: session.organizationId,
    clientOrganizationId: fields.clientOrganizationId ?? null,
    projectId: fields.projectId ?? null,
    targetType: fields.targetType ?? null,
    targetId: fields.targetId ?? null,
    ...(fields.metadata ? { metadata: fields.metadata } : {}),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * Establishes a session for an already-authenticated user and returns their account view plus
   * the session cookie to set. A CLIENT_OWNER is pinned to their own (client) organization; an
   * AGENCY/PLATFORM user has no fixed client. Credential verification is out of scope (see the
   * scope note in session-cookie.ts) — `input.user` is assumed already verified upstream.
   */
  async login(input: LoginInput): Promise<ApiResponseV1<LoginResultV1>> {
    const memberships = await this.deps.memberships.listActiveByUser(input.user.id);
    const membership = memberships[0];
    if (!membership) {
      return apiErr("UNAUTHENTICATED", "No active membership for this user.");
    }

    const org = await this.deps.organizations.findById(membership.organizationId);
    if (!org) {
      return apiErr("INTERNAL_ERROR", "Membership references a missing organization.");
    }

    const role = membership.role;
    const activeClientOrganizationId = pinnedClientOrganizationId(role, org.id);

    const assignedClientOrganizationIds = isAgencyRole(role)
      ? (await this.deps.agencyClients.listActiveClientsForAgency(org.id)).map(
          (c) => c.clientOrganizationId,
        )
      : [];

    const authenticatedSession: AuthenticatedSession = {
      sessionId: "", // filled after issuing the persisted Session below
      userId: input.user.id,
      email: input.user.email,
      displayName: input.user.displayName ?? null,
      role,
      organizationId: org.id,
      organizationType: org.type,
      activeClientOrganizationId,
      assignedClientOrganizationIds,
      actingClientOrganizationId: null,
    };

    const ctx = contextFromSession(authenticatedSession);
    const persisted = issueSession(
      membership,
      { membershipId: membership.id, sessionVersion: input.sessionVersion ?? 1 },
      ctx,
      { now: input.now, ...(input.sessionId ? { id: input.sessionId } : {}), ...(input.ttlMs ? { ttlMs: input.ttlMs } : {}) },
    );
    await this.deps.sessions.create(persisted);

    const resolved: AuthenticatedSession = { ...authenticatedSession, sessionId: persisted.id };

    const cookiePayload: AcceptanceSessionCookiePayload = {
      actorUserId: resolved.userId,
      role: resolved.role,
      organizationId: resolved.organizationId,
      organizationType: resolved.organizationType,
      activeClientOrganizationId: resolved.activeClientOrganizationId,
    };

    return apiOk({
      account: buildAccountView(input.user, role, org),
      session: resolved,
      sessionCookieName: SESSION_COOKIE_NAME,
      sessionCookie: encodeSessionCookie(cookiePayload),
    });
  }

  /** Revokes a session. Idempotent at the store level; always reports success. */
  async logout(sessionId: string, now: Date): Promise<ApiResponseV1<{ sessionId: string }>> {
    await this.deps.sessions.revoke(sessionId, now);
    return apiOk({ sessionId });
  }

  /** Maps a resolved session to its client-facing account view (org name resolved via the port). */
  async getAccount(session: AuthenticatedSession): Promise<ApiResponseV1<AccountViewV1>> {
    const org = await this.deps.organizations.findById(session.organizationId);
    if (!org) {
      return apiErr("INTERNAL_ERROR", "Session references a missing organization.");
    }
    const user: AuthenticatedUser = {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
    };
    return apiOk(buildAccountView(user, session.role, org));
  }

  /**
   * Accepts a PENDING, unexpired, unrevoked invitation whose token hashes to `tokenHash`, and
   * returns the resulting account view. Deliberately does NOT auto-approve anything else (no
   * cascading grants, no session issuance): the caller/route drives session establishment
   * separately after acceptance.
   */
  async acceptInvitation(input: AcceptInvitationInput): Promise<ApiResponseV1<AccountViewV1>> {
    const invitation = await this.deps.invitations.findByTokenHash(input.tokenHash);
    if (!invitation) {
      return apiErr("NOT_FOUND", "Invitation not found.");
    }

    if (!isInvitationUsable(invitation, input.now)) {
      const status = effectiveInvitationStatus(invitation, input.now);
      return apiErr("CONFLICT", `Invitation is ${status} and cannot be accepted.`, { status });
    }

    if (invitation.invitedEmail.toLowerCase() !== input.user.email.toLowerCase()) {
      return apiErr("FORBIDDEN", "Invitation was issued to a different email address.");
    }

    const org = await this.deps.organizations.findById(invitation.organizationId);
    if (!org) {
      return apiErr("INTERNAL_ERROR", "Invitation references a missing organization.");
    }

    return apiOk(buildAccountView(input.user, invitation.role, org));
  }

  /**
   * Lists the ACTIVE-assigned client portfolio for an agency session. Only agency roles may call
   * this; any other role is FORBIDDEN. Only clients with an ACTIVE assignment appear (enforced by
   * the reader's contract).
   */
  async listAgencyClients(
    session: AuthenticatedSession,
  ): Promise<ApiResponseV1<AgencyClientPortfolioViewV1>> {
    if (!isAgencyRole(session.role)) {
      return apiErr("FORBIDDEN", "Only agency members can view the client portfolio.");
    }

    const agencyOrg = await this.deps.organizations.findById(session.organizationId);
    if (!agencyOrg) {
      return apiErr("INTERNAL_ERROR", "Session references a missing organization.");
    }

    const assigned = await this.deps.agencyClients.listActiveClientsForAgency(session.organizationId);
    const clients: AgencyClientPortfolioItemV1[] = [];
    for (const client of assigned) {
      const projects = await this.deps.projects.listForClient(client.clientOrganizationId);
      clients.push({
        clientOrganizationId: client.clientOrganizationId,
        clientOrganizationName: client.clientOrganizationName,
        projectCount: projects.length,
        openReviewCount: client.openReviewCount,
      });
    }

    return apiOk({
      agencyOrganizationId: agencyOrg.id,
      agencyOrganizationName: agencyOrg.displayName,
      clients,
    });
  }

  /**
   * Selects the client an agency session acts for. Rejects with FORBIDDEN (and a DENIED audit
   * intent) if the caller is not an agency role or has no ACTIVE assignment to the target client.
   * On success, updates the resolved session's acting client and emits an "access-context-changed"
   * ALLOWED audit intent for the wiring lane to persist.
   */
  async setAgencyContext(
    session: AuthenticatedSession,
    clientOrganizationId: string,
  ): Promise<SetAgencyContextResultV1> {
    if (!isAgencyRole(session.role)) {
      return {
        response: apiErr("FORBIDDEN", "Only agency members can select a client context."),
        session,
        auditIntents: [
          deniedAudit("access-context-changed", session, {
            clientOrganizationId,
            targetType: "organization",
            targetId: clientOrganizationId,
          }),
        ],
      };
    }

    const authorized = await this.deps.agencyClients.isAgencyAuthorizedForClient(
      session.organizationId,
      clientOrganizationId,
    );
    if (!authorized) {
      return {
        response: apiErr("FORBIDDEN", "Agency is not assigned to this client organization."),
        session,
        auditIntents: [
          deniedAudit("access-context-changed", session, {
            clientOrganizationId,
            targetType: "organization",
            targetId: clientOrganizationId,
          }),
        ],
      };
    }

    const client = await this.deps.organizations.findById(clientOrganizationId);
    if (!client) {
      return {
        response: apiErr("NOT_FOUND", "Client organization not found."),
        session,
        auditIntents: [],
      };
    }

    const agencyOrg = await this.deps.organizations.findById(session.organizationId);
    if (!agencyOrg) {
      return {
        response: apiErr("INTERNAL_ERROR", "Session references a missing organization."),
        session,
        auditIntents: [],
      };
    }

    const updatedSession: AuthenticatedSession = {
      ...session,
      actingClientOrganizationId: clientOrganizationId,
    };

    const context: AgencyActingContextV1 = {
      agencyOrganizationId: agencyOrg.id,
      agencyOrganizationName: agencyOrg.displayName,
      actingClientOrganizationId: client.id,
      actingClientOrganizationName: client.displayName,
      surface: "agency",
    };

    return {
      response: apiOk(context),
      session: updatedSession,
      auditIntents: [
        {
          action: "access-context-changed",
          outcome: "ALLOWED",
          actorUserId: session.userId,
          actorOrganizationId: session.organizationId,
          clientOrganizationId,
          projectId: null,
          targetType: "organization",
          targetId: clientOrganizationId,
        },
      ],
    };
  }

  /**
   * Reads a project view with tenant/authorization checks. Cross-tenant access is FORBIDDEN and
   * emits a DENIED audit intent. A CLIENT_OWNER may only reach their own org's projects; an AGENCY
   * may only reach a project of a client it is assigned to, and — once it has selected a client
   * via setAgencyContext — only that client's projects.
   */
  async getProject(
    session: AuthenticatedSession,
    projectId: string,
  ): Promise<AuditedResultV1<ProjectViewV1>> {
    const project = await this.deps.projects.findById(projectId);
    if (!project) {
      return { response: apiErr("NOT_FOUND", "Project not found."), auditIntents: [] };
    }

    const targetClientOrgId = project.clientOrganizationId;
    const ctx = contextFromSession(session);

    const baseAllowed = canAccessClientOrganization(ctx, targetClientOrgId);
    // An agency that has selected a client may only touch that client's projects, even if it is
    // assigned to others — the acting context narrows, never widens, access.
    const actingBlocks =
      isAgencyRole(session.role) &&
      session.actingClientOrganizationId !== null &&
      session.actingClientOrganizationId !== targetClientOrgId;

    if (!baseAllowed || actingBlocks) {
      return {
        response: apiErr("FORBIDDEN", "Not authorized to access this project."),
        auditIntents: [
          deniedAudit("project-access-denied", session, {
            clientOrganizationId: targetClientOrgId,
            projectId: project.id,
            targetType: "project",
            targetId: project.id,
          }),
        ],
      };
    }

    const clientOrg = await this.deps.organizations.findById(targetClientOrgId);
    if (!clientOrg) {
      return {
        response: apiErr("INTERNAL_ERROR", "Project references a missing client organization."),
        auditIntents: [],
      };
    }

    const view: ProjectViewV1 = {
      id: project.id,
      name: project.name,
      clientOrganizationId: clientOrg.id,
      clientOrganizationName: clientOrg.displayName,
      createdAt: project.createdAt,
    };
    return { response: apiOk(view), auditIntents: [] };
  }
}

/** Convenience factory mirroring the constructor for call sites that prefer a function. */
export function createAuthService(deps: AuthServiceDeps): AuthService {
  return new AuthService(deps);
}
