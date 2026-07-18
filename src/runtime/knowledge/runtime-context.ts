/**
 * Lane-local composition + request-layer wiring for the knowledge-base App Router routes
 * (checkpoint KNOWLEDGE_API_V1, Agent D3).
 *
 * This is the knowledge lane's own runtime — deliberately NOT src/composition (Agent A owns the
 * global composition root). It builds:
 *   - a DatabasePort-backed set of knowledge repositories (the D1 ports),
 *   - a KnowledgeContentStore + the D2 KnowledgeIngestionService (parser + doc/version repos),
 *   - the shared tenancy repositories (sessions/organizations) needed to resolve a request cookie
 *     into a server-derived principal.
 *
 * Authorization model (SYSTEM_INVARIANTS_V1): the cookie only says *which user*. Role / org and
 * therefore the client organization a caller may operate under are re-derived server-side from the
 * persisted Session + Organization, never trusted from the cookie. A caller may only touch a
 * package (or create one under a project) whose client_organization_id matches the client org they
 * operate under; any cross-tenant / unresolved access is FORBIDDEN.
 *
 * A lazy singleton backs the real routes (createPgDatabase(loadDatabaseConfig()!)); tests inject a
 * runtime pointed at the throwaway test database via __setKnowledgeRuntimeForTests.
 */
import type { OrganizationType, PlatformRole } from "../../contracts/tenancy/entities.js";
import { SESSION_COOKIE_NAME, decodeSessionCookie } from "../../lib/session-cookie.js";
import { loadDatabaseConfig } from "../../persistence/config.js";
import type { DatabasePort } from "../../persistence/database-port.js";
import { createPgDatabase } from "../../persistence/pg/pg-database.js";
import { PgOrganizationRepository } from "../../persistence/pg/organization-repository.js";
import { PgProjectRepository } from "../../persistence/pg/project-repository.js";
import { PgSessionRepository } from "../../persistence/pg/session-repository.js";
import { InMemoryKnowledgeContentStore, type KnowledgeContentStore } from "./ingestion/content-store.js";
import { KnowledgeIngestionService } from "./ingestion/ingestion-service.js";
import { DefaultKnowledgeParser } from "./ingestion/parsers.js";
import { PgKnowledgeDocumentRepository } from "./pg/document-repository.js";
import { PgKnowledgeIssueRepository } from "./pg/issue-repository.js";
import { PgKnowledgePackageRepository } from "./pg/package-repository.js";
import { PgKnowledgeSnapshotRepository } from "./pg/snapshot-repository.js";
import { PgKnowledgeVersionRepository } from "./pg/version-repository.js";
import type {
  EnterpriseProfileRepository,
  KnowledgeDocumentRepository,
  KnowledgeIssueRepository,
  KnowledgePackageRepository,
  KnowledgeSnapshotRepository,
  KnowledgeVersionRepository,
} from "./ports.js";
import { PgEnterpriseProfileRepository } from "./pg/enterprise-profile-repository.js";

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

/** The server-derived identity for one knowledge request. Never trusts the cookie past the user. */
export interface KnowledgePrincipal {
  readonly userId: string;
  readonly role: PlatformRole;
  readonly organizationId: string;
  readonly organizationType: OrganizationType;
  /**
   * The single client organization this principal may operate under, or null when it cannot be
   * resolved (an agency with no active client selected). All package/project access is scoped to
   * this id; a mismatch is FORBIDDEN.
   */
  readonly clientOrganizationId: string | null;
}

/**
 * The client org a principal operates under: a CLIENT organization operates under itself; an
 * agency/platform principal operates under the client they have actively selected (if any).
 */
export function effectiveClientOrganizationId(
  principal: KnowledgePrincipal,
): string | null {
  if (principal.organizationType === "CLIENT") return principal.organizationId;
  return principal.clientOrganizationId;
}

/** True iff the principal may touch a resource owned by `resourceClientOrganizationId`. */
export function principalOwnsClient(
  principal: KnowledgePrincipal,
  resourceClientOrganizationId: string,
): boolean {
  const own = effectiveClientOrganizationId(principal);
  return own !== null && own === resourceClientOrganizationId;
}

// ---------------------------------------------------------------------------
// Repository bundle
// ---------------------------------------------------------------------------

export interface KnowledgeRepositories {
  readonly packages: KnowledgePackageRepository;
  readonly documents: KnowledgeDocumentRepository;
  readonly versions: KnowledgeVersionRepository;
  readonly issues: KnowledgeIssueRepository;
  readonly snapshots: KnowledgeSnapshotRepository;
  readonly enterpriseProfiles: EnterpriseProfileRepository;
}

/** Binds every knowledge repository to one DatabasePort (snapshot repo needs transactions). */
export function createKnowledgeRepositories(db: DatabasePort): KnowledgeRepositories {
  return {
    packages: new PgKnowledgePackageRepository(db),
    documents: new PgKnowledgeDocumentRepository(db),
    versions: new PgKnowledgeVersionRepository(db),
    issues: new PgKnowledgeIssueRepository(db),
    snapshots: new PgKnowledgeSnapshotRepository(db),
    enterpriseProfiles: new PgEnterpriseProfileRepository(db),
  };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface KnowledgeRuntime {
  readonly db: DatabasePort;
  readonly knowledge: KnowledgeRepositories;
  readonly projects: PgProjectRepository;
  readonly contentStore: KnowledgeContentStore;
  readonly ingestion: KnowledgeIngestionService;
  /** Resolves the raw Cookie header to a server-derived principal, or null when unauthenticated. */
  resolveSession(cookieHeader: string | null | undefined): Promise<KnowledgePrincipal | null>;
}

export interface CreateKnowledgeRuntimeOptions {
  /** Test seam: inject a fake content store (defaults to an in-memory one). */
  readonly contentStore?: KnowledgeContentStore;
}

export function createKnowledgeRuntime(
  db: DatabasePort,
  options: CreateKnowledgeRuntimeOptions = {},
): KnowledgeRuntime {
  const knowledge = createKnowledgeRepositories(db);
  const projects = new PgProjectRepository(db);
  const sessions = new PgSessionRepository(db);
  const organizations = new PgOrganizationRepository(db);
  const contentStore = options.contentStore ?? new InMemoryKnowledgeContentStore();
  const ingestion = new KnowledgeIngestionService(
    new DefaultKnowledgeParser(),
    knowledge.documents,
    knowledge.versions,
    contentStore,
  );

  async function resolveSession(
    cookieHeader: string | null | undefined,
  ): Promise<KnowledgePrincipal | null> {
    const payload = decodeSessionCookie(readCookie(cookieHeader, SESSION_COOKIE_NAME));
    if (!payload) return null;

    // Validity (not revoked, not expired) is enforced by the query; take the newest valid row.
    const active = await sessions.listActiveByUser(payload.actorUserId);
    const session = active[0];
    if (!session) return null;

    const org = await organizations.findById(session.organizationId);
    if (!org) return null;

    return {
      userId: session.userId,
      role: session.role,
      organizationId: session.organizationId,
      organizationType: org.type,
      clientOrganizationId:
        org.type === "CLIENT" ? session.organizationId : session.activeClientOrganizationId,
    };
  }

  return { db, knowledge, projects, contentStore, ingestion, resolveSession };
}

// ---------------------------------------------------------------------------
// Lazy singleton for the real routes + a test seam
// ---------------------------------------------------------------------------

let runtimeSingleton: KnowledgeRuntime | null = null;

/** The process-wide knowledge runtime, built once from the runtime database URL. */
export function getKnowledgeRuntime(): KnowledgeRuntime {
  if (!runtimeSingleton) {
    const config = loadDatabaseConfig();
    if (!config) {
      throw new Error(
        "GEO_DATABASE_URL is not configured; cannot build the knowledge runtime.",
      );
    }
    runtimeSingleton = createKnowledgeRuntime(createPgDatabase(config));
  }
  return runtimeSingleton;
}

/** Test seam: point the routes at an injected runtime (e.g. the throwaway test database). */
export function __setKnowledgeRuntimeForTests(runtime: KnowledgeRuntime | null): void {
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
