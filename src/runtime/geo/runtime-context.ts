/**
 * GEO_READ_API_V1 (Agent E4) — lane-local composition + request-layer wiring for
 * the GEO read-side App Router routes (keyword-questions / opportunities /
 * review-queue / deliveries).
 *
 * This is the GEO lane's OWN runtime — deliberately NOT src/composition (Agent A
 * owns the global composition root), mirroring the auth (C2) and knowledge (D3)
 * lane runtimes. It builds:
 *   - the GEO Pg read repositories over one DatabasePort (the E1 keyword/
 *     opportunity/human-review adapters, reused read-only, plus this lane's
 *     read-only GeoReadRepository for the projections the write ports do not
 *     expose),
 *   - the shared tenancy repositories (sessions / organizations / agency
 *     assignments / projects) needed to resolve a request cookie into a
 *     server-derived principal and to scope a project to its owning client org.
 *
 * Authorization model (SYSTEM_INVARIANTS_V1): the cookie only says *which user*.
 * Role / org — and therefore which projects a caller may read — are re-derived
 * server-side from the persisted Session + Organization, never trusted from the
 * cookie. A CLIENT principal may read only its own client org's projects; an
 * agency principal may read only projects of a client it is ACTIVE-assigned to;
 * a platform super admin (ops surface) may read any project. Any other case is
 * FORBIDDEN.
 *
 * A lazy singleton backs the real routes (createPgDatabase(loadDatabaseConfig()!));
 * tests inject a runtime pointed at the throwaway test database via
 * __setGeoRuntimeForTests.
 */
import type { OrganizationType, PlatformRole } from "../../contracts/tenancy/entities.js";
import { SESSION_COOKIE_NAME, decodeSessionCookie } from "../../lib/session-cookie.js";
import { loadDatabaseConfig } from "../../persistence/config.js";
import type { DatabasePort } from "../../persistence/database-port.js";
import { createPgDatabase } from "../../persistence/pg/pg-database.js";
import { createRepositories, type Repositories } from "../../persistence/repository-factory.js";
import { PgHumanReviewRepository } from "./pg/human-review-repository.js";
import { PgKeywordQuestionMapRepository } from "./pg/keyword-question-map-repository.js";
import { PgOpportunityRepository } from "./pg/opportunity-repository.js";
import { GeoReadRepository } from "./pg/geo-read-repository.js";
import type {
  HumanReviewRepository,
  KeywordQuestionMapRepository,
  OpportunityRepository,
} from "./ports.js";

const AGENCY_ROLES: readonly PlatformRole[] = ["AGENCY_OWNER", "AGENCY_OPERATOR"];
function isAgencyRole(role: PlatformRole): boolean {
  return AGENCY_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

/** The server-derived identity for one GEO read request. Never trusts the cookie past the user. */
export interface GeoPrincipal {
  readonly userId: string;
  readonly role: PlatformRole;
  readonly organizationId: string;
  readonly organizationType: OrganizationType;
  /** For a CLIENT principal: their own org id (the client org they operate under). Null otherwise. */
  readonly clientOrganizationId: string | null;
  /** For an agency principal: the set of client org ids it is ACTIVE-assigned to. Empty otherwise. */
  readonly assignedClientOrganizationIds: readonly string[];
}

/**
 * True iff `principal` may read resources owned by `resourceClientOrganizationId`:
 *   - a platform super admin (ops surface) may read any client's data;
 *   - a CLIENT principal may read only its own client org;
 *   - an agency principal may read only clients it is ACTIVE-assigned to.
 */
export function principalCanReadClientOrganization(
  principal: GeoPrincipal,
  resourceClientOrganizationId: string,
): boolean {
  if (principal.role === "PLATFORM_SUPER_ADMIN") return true;
  if (principal.organizationType === "CLIENT") {
    return principal.clientOrganizationId === resourceClientOrganizationId;
  }
  return principal.assignedClientOrganizationIds.includes(resourceClientOrganizationId);
}

// ---------------------------------------------------------------------------
// Repository bundle
// ---------------------------------------------------------------------------

export interface GeoRepositories {
  readonly keywordQuestionMaps: KeywordQuestionMapRepository;
  readonly opportunities: OpportunityRepository;
  readonly humanReviews: HumanReviewRepository;
  readonly reads: GeoReadRepository;
}

/** Binds every GEO read repository to one DatabasePort. */
export function createGeoRepositories(db: DatabasePort): GeoRepositories {
  return {
    keywordQuestionMaps: new PgKeywordQuestionMapRepository(db),
    opportunities: new PgOpportunityRepository(db),
    humanReviews: new PgHumanReviewRepository(db),
    reads: new GeoReadRepository(db),
  };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface GeoRuntime {
  readonly db: DatabasePort;
  readonly geo: GeoRepositories;
  /** Shared tenancy repositories (sessions/organizations/agency assignments/projects). */
  readonly tenancy: Repositories;
  /** Resolves the raw Cookie header to a server-derived principal, or null when unauthenticated. */
  resolveSession(cookieHeader: string | null | undefined): Promise<GeoPrincipal | null>;
}

export function createGeoRuntime(db: DatabasePort): GeoRuntime {
  const geo = createGeoRepositories(db);
  const tenancy = createRepositories(db);

  async function resolveSession(
    cookieHeader: string | null | undefined,
  ): Promise<GeoPrincipal | null> {
    const payload = decodeSessionCookie(readCookie(cookieHeader, SESSION_COOKIE_NAME));
    if (!payload) return null;

    // Validity (not revoked, not expired) is enforced by the query; take the newest valid row.
    const active = await tenancy.sessions.listActiveByUser(payload.actorUserId);
    const session = active[0];
    if (!session) return null;

    const org = await tenancy.organizations.findById(session.organizationId);
    if (!org) return null;

    const assignedClientOrganizationIds = isAgencyRole(session.role)
      ? await tenancy.agencyClientAssignments.listActiveClientIds(session.organizationId)
      : [];

    return {
      userId: session.userId,
      role: session.role,
      organizationId: session.organizationId,
      organizationType: org.type,
      clientOrganizationId: org.type === "CLIENT" ? session.organizationId : null,
      assignedClientOrganizationIds,
    };
  }

  return { db, geo, tenancy, resolveSession };
}

// ---------------------------------------------------------------------------
// Lazy singleton for the real routes + a test seam
// ---------------------------------------------------------------------------

let runtimeSingleton: GeoRuntime | null = null;

/** The process-wide GEO runtime, built once from the runtime database URL. */
export function getGeoRuntime(): GeoRuntime {
  if (!runtimeSingleton) {
    const config = loadDatabaseConfig();
    if (!config) {
      throw new Error("GEO_DATABASE_URL is not configured; cannot build the GEO runtime.");
    }
    runtimeSingleton = createGeoRuntime(createPgDatabase(config));
  }
  return runtimeSingleton;
}

/** Test seam: point the routes at an injected runtime (e.g. the throwaway test database). */
export function __setGeoRuntimeForTests(runtime: GeoRuntime | null): void {
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
