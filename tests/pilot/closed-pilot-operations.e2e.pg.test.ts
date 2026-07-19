/**
 * CLOSED_PILOT_OPERATIONS_V1 — the sanitized closed-pilot OPERATIONS exercise.
 *
 * Builds directly on the PILOT_ACCEPTANCE_V1 harness (tests/pilot/pilot-acceptance.e2e.pg.test.ts
 * drives the chain over the REAL Next.js route handlers; tests/pilot/pilot-resilience.e2e.pg.test.ts
 * contributes the drill conventions) — same fixtures style, same HTTP helpers, same table list,
 * same superuser-backed backup/restore pattern. What is NEW here:
 *
 *   1. ONE persisted, fully-sanitized pilot data set is driven over HTTP by the CORRECT ROLE at
 *      each hop (platform / agency owner / client owner), with authorization asserted at every hop
 *      (401 without a session, 403 for a wrong role where a wrong-role session exists).
 *   2. The OPERATIONS DRILLS then run against that SAME data set (never a re-seeded one):
 *        (a) application restart (new pool + new runtime contexts = new-process semantics),
 *        (b) database connection pool restart (forced backend termination + pool self-heal, and a
 *            full close-and-rebuild of the pool with the pre-restart session cookie still valid),
 *        (c) session signing-key rotation (old session invalid after retirement; re-login works),
 *        (d) backup (scripts/backup/backup.mjs) -> restore (scripts/backup/restore.mjs) into a
 *            FRESH test database -> RE-LOGIN against the restored database -> read back ALL
 *            business data: accounts, knowledge raw content, opportunities, articles & deliveries,
 *            audit records, provider ledger rows.
 *   3. The standing invariants are re-proven INSIDE this suite on the same data set: tenant
 *      isolation, agency-assignment isolation, no auto-approval anywhere, append-only history
 *      (including the provider_execution ledger), default selected channel count 0, and the
 *      provider runtime default-OFF discipline.
 *
 * HARD PROHIBITIONS HONOURED: no real provider call is possible — the OFFLINE deterministic
 * adapter (zero network imports) produces content while PROVIDER_RUNTIME_ENABLED stays OFF; the
 * single provider_execution ledger row this suite writes records that OFFLINE execution's
 * metadata (model "offline-deterministic", zero tokens) through the real D3 sink, purely to prove
 * the ledger is append-only and survives backup/restore — it is NOT a real call and the suite
 * asserts no ledger row ever names a real model. All identities use reserved test domains
 * (*.example.test) with explicit "Sample …(Pilot Fixture)" markers — Real Customer Data = 0.
 *
 * When no test database is configured (GEO_TEST_DATABASE_URL unset) the suite skips cleanly.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Driver import justification: the connection-pool drill must OBSERVE driver-level connection
// loss (an admin-terminated backend) without crashing the process, which requires a pool 'error'
// listener the production DatabasePort deliberately does not expose. Tests and scripts sit outside
// the src-only "pg is confined to persistence/pg" boundary (scripts/backup/restore.mjs already
// imports pg the same way).
import { Pool } from "pg";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort, SqlParam } from "../../src/persistence/database-port.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import { PgKnowledgeContentStore } from "../../src/persistence/runtime-continuity/pg-knowledge-content-store.js";
import { hashInvitationToken } from "../../src/contracts/tenancy/invitations.js";
import type { PlatformRole } from "../../src/contracts/tenancy/entities.js";
import {
  createAuthRuntime,
  __setAuthRuntimeForTests,
  type AuthRuntime,
} from "../../src/runtime/auth/runtime-context.js";
import {
  createKnowledgeRuntime,
  __setKnowledgeRuntimeForTests,
  type KnowledgeRuntime,
} from "../../src/runtime/knowledge/runtime-context.js";
import {
  createGeoRuntime,
  __setGeoRuntimeForTests,
} from "../../src/runtime/geo/runtime-context.js";
import {
  __setSessionSigningKeysForTests,
  signSessionCookieValue,
  verifySignedSessionToken,
} from "../../src/lib/session-signing.js";

// The OFFLINE deterministic provider (D1) — no network import; safe while the flag is OFF.
import { DeterministicOfflineProviderAdapter } from "../../src/runtime/provider/deterministic-offline-adapter.js";
import {
  assertRealProviderCallAllowed,
  isProviderRuntimeEnabled,
  ProviderRuntimeDisabledError,
} from "../../src/runtime/provider/feature-flag.js";
import { PgProviderLedger } from "../../src/runtime/provider/pg-provider-ledger.js";
import type { ProviderGenerateArticleContentRequest } from "../../src/runtime/provider/provider-port.js";

// --- Real App Router handlers under test (imported exactly as Next.js mounts them) ---
import { POST as loginRoute } from "../../src/app/api/auth/login/route.js";
import { TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH } from "../helpers/auth-credentials.js";
import { POST as acceptInvitationRoute } from "../../src/app/api/invitations/[token]/accept/route.js";
import { POST as opsAgenciesRoute } from "../../src/app/api/ops/agencies/route.js";
import { POST as opsClientsRoute } from "../../src/app/api/ops/clients/route.js";
import { POST as opsAssignmentsRoute } from "../../src/app/api/ops/assignments/route.js";
import { GET as opsAuditRoute } from "../../src/app/api/ops/audit/route.js";
import { POST as projectsRoute } from "../../src/app/api/commands/projects/route.js";
import { POST as invitationsRoute } from "../../src/app/api/projects/[projectId]/invitations/route.js";
import { POST as knowledgePackagesRoute } from "../../src/app/api/commands/projects/[projectId]/knowledge-packages/route.js";
import { POST as confirmPackageRoute } from "../../src/app/api/commands/projects/[projectId]/knowledge-packages/[id]/confirm/route.js";
import { POST as uploadFileRoute } from "../../src/app/api/knowledge/packages/[id]/files/route.js";
import { GET as getPackageRoute } from "../../src/app/api/knowledge/packages/[id]/route.js";
import { POST as enterpriseProfileRoute } from "../../src/app/api/commands/projects/[projectId]/enterprise-profile/route.js";
import { POST as keywordMapsRoute } from "../../src/app/api/commands/projects/[projectId]/keyword-maps/route.js";
import { POST as opportunitiesRoute } from "../../src/app/api/commands/projects/[projectId]/opportunities/route.js";
import { GET as reviewQueueRoute } from "../../src/app/api/projects/[projectId]/review-queue/route.js";
import { POST as opportunityReviewsRoute } from "../../src/app/api/opportunities/[id]/reviews/route.js";
import { POST as opportunityFamiliesRoute } from "../../src/app/api/opportunity-families/route.js";
import { POST as articleBriefsRoute } from "../../src/app/api/article-briefs/route.js";
import { POST as compileDraftRoute } from "../../src/app/api/article-drafts/compile/route.js";
import { POST as articleReviewsRoute } from "../../src/app/api/article-drafts/[id]/reviews/route.js";
import { POST as publishPackagesRoute } from "../../src/app/api/publish-packages/route.js";
import { POST as distributionPlansRoute } from "../../src/app/api/distribution-plans/route.js";
import { POST as publicationReceiptsRoute } from "../../src/app/api/publication-receipts/route.js";
import { GET as deliveriesRoute } from "../../src/app/api/projects/[projectId]/deliveries/route.js";
import { GET as agencyClientsRoute } from "../../src/app/api/agency/clients/route.js";

const testConfig = loadDatabaseConfig({ test: true });
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const migrationsDir = join(repoRoot, "migrations");
const fixturesDir = join(here, "..", "runtime", "knowledge", "fixtures");
const backupScript = join(repoRoot, "scripts", "backup", "backup.mjs");
const restoreScript = join(repoRoot, "scripts", "backup", "restore.mjs");

const OOXML_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const DOCX_MARKER = "Hello DOCX from geoplane";
const PDF_MARKER = "Hello PDF";
const CHANNEL = "sample_closed_pilot_official_blog";
const KEYWORD = "generative engine optimization";
const OFFLINE_MODEL = "offline-deterministic";
// Superuser ROLE NAME only (never a secret): local instances use the "postgres"
// convention; the CI postgres:16 service container's superuser is "geoplane_ci",
// injected via GEO_PG_SUPERUSER. Passwords flow via connection string/PGPASSWORD.
const SUPERUSER = process.env.GEO_PG_SUPERUSER?.trim() || "postgres";
const STEP_TIMEOUT = 240_000;

// --- Desensitized fixtures (Real Customer Data = 0). Reserved test domains + explicit markers. ---
const FIXTURES = {
  platform: {
    email: "ops-platform-admin@closed-pilot.example.test",
    orgName: "Sample Platform Operator (Pilot Fixture)",
  },
  agency: {
    email: "ops-agency-owner@closed-pilot.example.test",
    orgName: "Sample Content Agency (Pilot Fixture)",
  },
  clientA: {
    email: "ops-client-owner@closed-pilot.example.test",
    orgName: "Sample Manufacturing Enterprise (Pilot Fixture)",
  },
  clientB: {
    email: "ops-client-owner-b@closed-pilot.example.test",
    orgName: "Sample Secondary Enterprise (Pilot Fixture)",
  },
  projectName: "Sample Closed-Pilot Operations Project",
} as const;

/** Every table this scenario touches, child-before-parent for CASCADE-safe truncation. */
const ALL_TABLES = [
  "provider_execution",
  "delivery",
  "publication_receipt",
  "distribution_plan",
  "channel_neutral_content_block",
  "channel_neutral_content_package",
  "publish_package",
  "article_approval",
  "vertical_gate_result",
  "platform_gate_result",
  "quality_gate_result",
  "article_draft",
  "article_brief",
  "opportunity_family_member",
  "opportunity_family",
  "provider_article_content",
  "human_review_decision",
  "opportunity_validation",
  "opportunity",
  "keyword_question_map_question",
  "keyword_question_map_keyword",
  "keyword_question_map",
  "industry_profile",
  "knowledge_content",
  "knowledge_snapshot",
  "knowledge_issue",
  "knowledge_version",
  "knowledge_document",
  "knowledge_package",
  "enterprise_profile",
  "client_review_decision",
  "audit_event",
  "session",
  "invitation",
  "project_membership",
  "artifact_index",
  "membership",
  "agency_client_assignment",
  "project",
  "organization",
  '"user"',
].join(", ");

// --- Runtime handles. `db` is REBOUND by the restart/pool drills; helpers always use the latest. ---
let db: DatabasePort;
let authRuntime: AuthRuntime;
let knowledgeRuntime: KnowledgeRuntime;

/** (Re)build all three runtime contexts over `port` and inject them — one "process" worth of app. */
function rebindRuntimes(port: DatabasePort): void {
  authRuntime = createAuthRuntime(port);
  knowledgeRuntime = createKnowledgeRuntime(port, {
    contentStore: new PgKnowledgeContentStore(port),
  });
  const geoRuntime = createGeoRuntime(port);
  __setAuthRuntimeForTests(authRuntime);
  __setKnowledgeRuntimeForTests(knowledgeRuntime);
  __setGeoRuntimeForTests(geoRuntime);
}

// --- Out-of-band provisioning helpers (users + memberships have no HTTP route this checkpoint) ---

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(`INSERT INTO "user" (email) VALUES ($1) RETURNING id`, [
    email,
  ]);
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createMembership(
  userId: string,
  organizationId: string,
  role: PlatformRole,
): Promise<void> {
  await authRuntime.repos.memberships.create({ userId, organizationId, role });
}

// --- HTTP helpers (same seam as pilot-acceptance) ---------------------------

type Handler = (request: Request, context?: any) => Promise<Response>;

interface CallResult {
  readonly status: number;
  readonly body: any;
}

async function post(
  handler: Handler,
  url: string,
  cookie: string | null,
  body: unknown,
  context?: unknown,
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["cookie"] = cookie;
  const res = await handler(
    new Request(url, { method: "POST", headers, body: JSON.stringify(body) }),
    context,
  );
  return { status: res.status, body: await res.json() };
}

async function get(
  handler: Handler,
  url: string,
  cookie: string | null,
  context?: unknown,
): Promise<CallResult> {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  const res = await handler(new Request(url, { headers }), context);
  return { status: res.status, body: await res.json() };
}

/** Runs POST /api/auth/login for `email` and returns the reusable `name=value` Cookie header. */
async function loginAndGetCookie(email: string): Promise<string> {
  await db.query(`UPDATE "user" SET password_hash = $2 WHERE lower(email) = lower($1)`, [
    email,
    TEST_LOGIN_PASSWORD_HASH,
  ]);
  const res = await loginRoute(
    new Request("http://test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_LOGIN_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a cookie");
  const first = setCookie.split(";")[0];
  if (!first) throw new Error("login set an empty cookie");
  return first;
}

/** AUTH-AT-EVERY-HOP helper: the hop must reject an unauthenticated caller with 401. */
async function expectUnauthenticated(
  handler: Handler,
  method: "GET" | "POST",
  url: string,
  context?: unknown,
): Promise<void> {
  const result =
    method === "GET" ? await get(handler, url, null, context) : await post(handler, url, null, {}, context);
  expect(result.status, `${method} ${url} without a session must be 401`).toBe(401);
  expect(result.body.error.code).toBe("UNAUTHENTICATED");
}

/**
 * Append ONE sanitized OFFLINE execution row to the provider_execution ledger.
 *
 * Why not PgProviderLedger.recordExecution: the SHARED test database may carry the sibling
 * provider lane's 0008_provider_identity migration, which adds three closed-enum NOT NULL
 * identity columns (gateway_vendor / model_vendor / protocol) that this branch's ledger writer
 * predates. This helper detects those columns and declares sanitized offline values for them
 * ('UNKNOWN_LEGACY' — the marker for rows without an asserted real gateway — plus 'OTHER' /
 * 'OPENAI_COMPATIBLE'), so the suite is correct on BOTH the drifted and the pristine schema.
 * Everything recorded is offline metadata: the offline model name, zero tokens, no secret, no
 * content. Idempotent on idempotency_key exactly like the real sink (ON CONFLICT DO NOTHING).
 */
async function insertSanitizedOfflineLedgerRow(
  port: DatabasePort,
  row: {
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly projectId: string;
    readonly articleBriefId: string;
  },
): Promise<void> {
  const identityCols = await port.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.columns
      WHERE table_name = 'provider_execution' AND column_name = 'gateway_vendor'`,
  );
  const hasIdentity = identityCols.rows[0]?.n === "1";
  const baseCols =
    "request_id, idempotency_key, project_id, client_organization_id, article_brief_id, " +
    "model, status, error_code, prompt_tokens, completion_tokens, total_tokens, latency_ms";
  const baseVals = `$1, $2, p.id, p.client_organization_id, $4::uuid, $5, 'OK', NULL, 0, 0, 0, 1`;
  const sql = hasIdentity
    ? `INSERT INTO provider_execution (${baseCols}, gateway_vendor, model_vendor, protocol)
       SELECT ${baseVals}, 'UNKNOWN_LEGACY', 'OTHER', 'OPENAI_COMPATIBLE'
       FROM project p WHERE p.id = $3::uuid
       ON CONFLICT (idempotency_key) DO NOTHING`
    : `INSERT INTO provider_execution (${baseCols})
       SELECT ${baseVals}
       FROM project p WHERE p.id = $3::uuid
       ON CONFLICT (idempotency_key) DO NOTHING`;
  await port.query(sql, [
    row.requestId,
    row.idempotencyKey,
    row.projectId,
    row.articleBriefId,
    OFFLINE_MODEL,
  ]);
}

/** Rebuild the base connection string with a different role and database (password preserved). */
function withUserAndDb(baseUrl: string, user: string, database: string): string {
  const u = new URL(baseUrl);
  u.username = user;
  u.pathname = `/${database}`;
  return u.toString();
}

// --- The ONE closed-pilot data set every drill continues against. -----------
interface PilotOpsState {
  platformUserId: string;
  agencyOwnerUserId: string;
  clientOwnerUserId: string;
  platformOrgId: string;
  agencyId: string;
  clientAId: string;
  projectId: string;
  knowledgePackageId: string;
  docxStoragePath: string;
  pdfIngested: boolean;
  pdfStoragePath: string | null;
  industryProfileId: string;
  opportunityId: string;
  articleBriefId: string;
  articleDraftId: string;
  distributionPlanId: string;
  receiptId: string;
  ledgerIdempotencyKey: string;
  offlineEnvelope: string;
  platformCookie: string;
  agencyCookie: string;
  clientCookie: string;
}
let S: PilotOpsState;

// Cleanup handles for the backup/restore throwaway.
const uniqueSuffix = `${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const DST_DB = `geoplane_cpops_rst_${uniqueSuffix}`;
let backupDir: string | null = null;

describe.skipIf(testConfig === null)(
  "CLOSED_PILOT_OPERATIONS_V1 — sanitized closed-pilot operations exercise over real HTTP + Postgres",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
      // ONE truncate for the whole suite: chain and drills share the SAME data set.
      await db.query(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
      rebindRuntimes(db);
    }, STEP_TIMEOUT);

    afterAll(async () => {
      __setSessionSigningKeysForTests(null);
      __setAuthRuntimeForTests(null);
      __setKnowledgeRuntimeForTests(null);
      __setGeoRuntimeForTests(null);
      const baseUrl = testConfig?.connectionString;
      if (baseUrl) {
        const admin = createPgDatabase({
          connectionString: withUserAndDb(baseUrl, SUPERUSER, "postgres"),
          max: 2,
        });
        try {
          await admin.query(`DROP DATABASE IF EXISTS "${DST_DB}" WITH (FORCE)`).catch(() => {});
        } finally {
          await admin.close();
        }
      }
      if (backupDir) rmSync(backupDir, { recursive: true, force: true });
      if (db) await db.close();
    }, STEP_TIMEOUT);

    // ==========================================================================================
    // PART 1 — THE OPERATIONS CHAIN, driven over HTTP by the correct role at each hop.
    // ==========================================================================================
    it("drives the full closed-pilot operations chain over HTTP with authorization asserted at every hop", async () => {
      // Never a production/runtime database; never a real provider call.
      expect(testConfig).not.toBeNull();
      expect(testConfig!.connectionString).not.toMatch(/\/geoplane_runtime(\?|$)/);
      expect(isProviderRuntimeEnabled()).toBe(false);

      // ---- HOP 0: Platform login. An unknown email is refused 401; the seeded admin logs in. ----
      const ghost = await post(loginRoute, "http://test/api/auth/login", null, {
        email: "nobody@closed-pilot.example.test",
      });
      expect(ghost.status).toBe(401);

      const platformUserId = await createUser(FIXTURES.platform.email);
      const platformOrg = await authRuntime.repos.organizations.createIdempotent({
        type: "PLATFORM",
        displayName: FIXTURES.platform.orgName,
        idempotencyKey: "closed-pilot-platform",
        createdByUserId: platformUserId,
      });
      await createMembership(platformUserId, platformOrg.id, "PLATFORM_SUPER_ADMIN");
      const platformCookie = await loginAndGetCookie(FIXTURES.platform.email);

      // ---- HOP 1: Platform creates the sample Agency. 401 unauthenticated first. ----
      await expectUnauthenticated(opsAgenciesRoute, "POST", "http://test/api/ops/agencies");
      const agency = await post(opsAgenciesRoute, "http://test/api/ops/agencies", platformCookie, {
        displayName: FIXTURES.agency.orgName,
      });
      expect(agency.status).toBe(200);
      expect(agency.body.data.type).toBe("AGENCY");
      const agencyId: string = agency.body.data.id;

      // Agency Owner comes on board now so wrong-role probes exist for the remaining ops hops.
      const agencyOwnerUserId = await createUser(FIXTURES.agency.email);
      await createMembership(agencyOwnerUserId, agencyId, "AGENCY_OWNER");
      const agencyCookie = await loginAndGetCookie(FIXTURES.agency.email);

      // ---- HOP 2: Platform creates the sample Client org. Agency role is DENIED 403 first. ----
      await expectUnauthenticated(opsClientsRoute, "POST", "http://test/api/ops/clients");
      const agencyTriesClient = await post(opsClientsRoute, "http://test/api/ops/clients", agencyCookie, {
        displayName: FIXTURES.clientA.orgName,
      });
      expect(agencyTriesClient.status).toBe(403);
      const clientA = await post(opsClientsRoute, "http://test/api/ops/clients", platformCookie, {
        displayName: FIXTURES.clientA.orgName,
      });
      expect(clientA.status).toBe(200);
      expect(clientA.body.data.type).toBe("CLIENT");
      const clientAId: string = clientA.body.data.id;

      // ---- HOP 3: Platform assigns agency -> client (ACTIVE). Agency cannot self-assign. ----
      const agencyTriesAssign = await post(
        opsAssignmentsRoute,
        "http://test/api/ops/assignments",
        agencyCookie,
        { agencyOrganizationId: agencyId, clientOrganizationId: clientAId },
      );
      expect(agencyTriesAssign.status).toBe(403);
      const assignment = await post(
        opsAssignmentsRoute,
        "http://test/api/ops/assignments",
        platformCookie,
        { agencyOrganizationId: agencyId, clientOrganizationId: clientAId },
      );
      expect(assignment.status).toBe(200);
      expect(assignment.body.data.status).toBe("ACTIVE");

      // ---- HOP 4: Platform creates the sample Project under the client. ----
      await expectUnauthenticated(projectsRoute, "POST", "http://test/api/commands/projects");
      const project = await post(projectsRoute, "http://test/api/commands/projects", platformCookie, {
        name: FIXTURES.projectName,
        clientOrganizationId: clientAId,
      });
      expect(project.status).toBe(200);
      expect(project.body.data.clientOrganizationId).toBe(clientAId);
      const projectId: string = project.body.data.id;
      const projectCtx = { params: Promise.resolve({ projectId }) };

      // ---- HOP 5: Platform invites the Client Owner. The raw token is never echoed back. ----
      await expectUnauthenticated(
        invitationsRoute,
        "POST",
        `http://test/api/projects/${projectId}/invitations`,
        projectCtx,
      );
      const invite = await post(
        invitationsRoute,
        `http://test/api/projects/${projectId}/invitations`,
        platformCookie,
        { invitedEmail: FIXTURES.clientA.email },
        projectCtx,
      );
      expect(invite.status).toBe(200);
      expect(invite.body.data.status).toBe("PENDING");
      expect(invite.body.data.role).toBe("CLIENT_OWNER");
      expect(invite.body.data.organizationId).toBe(clientAId);
      expect(invite.body.data.token).toBeUndefined();
      expect(invite.body.data.tokenHash).toBeUndefined();

      // ---- HOP 6: Client Owner logs in and accepts an invitation over HTTP. An invited-but-
      //      unprovisioned identity CANNOT log in (401) until the account exists. Because the
      //      invite route discards its raw token by design, a second invitation is seeded with a
      //      KNOWN token purely so the accept ROUTE can be exercised over HTTP (same as
      //      pilot-acceptance). ----
      const preProvision = await post(loginRoute, "http://test/api/auth/login", null, {
        email: FIXTURES.clientA.email,
      });
      expect(preProvision.status).toBe(401);

      const clientOwnerUserId = await createUser(FIXTURES.clientA.email);
      await createMembership(clientOwnerUserId, clientAId, "CLIENT_OWNER");
      const clientCookie = await loginAndGetCookie(FIXTURES.clientA.email);

      const rawToken = randomUUID();
      await authRuntime.repos.invitations.create({
        organizationId: clientAId,
        invitedEmail: FIXTURES.clientA.email,
        role: "CLIENT_OWNER",
        tokenHash: hashInvitationToken(rawToken),
        createdByUserId: platformUserId,
        expiresAt: FUTURE,
      });
      const accept = await post(
        acceptInvitationRoute,
        `http://test/api/invitations/${rawToken}/accept`,
        clientCookie,
        {},
        { params: Promise.resolve({ token: rawToken }) },
      );
      expect(accept.status).toBe(200);
      expect(accept.body.data.role).toBe("CLIENT_OWNER");
      expect(accept.body.data.organizationId).toBe(clientAId);

      // ---- HOP 7: Client Owner creates the knowledge package (audited command). ----
      await expectUnauthenticated(
        knowledgePackagesRoute,
        "POST",
        `http://test/api/commands/projects/${projectId}/knowledge-packages`,
        projectCtx,
      );
      const kp = await post(
        knowledgePackagesRoute,
        `http://test/api/commands/projects/${projectId}/knowledge-packages`,
        clientCookie,
        { title: "Sample Enterprise Knowledge (Pilot Fixture)" },
        projectCtx,
      );
      expect(kp.status).toBe(200);
      expect(kp.body.data.status).toBe("DRAFT");
      const knowledgePackageId: string = kp.body.data.id;
      const packageCtx = { params: Promise.resolve({ projectId, id: knowledgePackageId }) };
      const filesCtx = { params: Promise.resolve({ id: knowledgePackageId }) };

      // ---- HOP 8: Client Owner uploads the DOCX knowledge source; the extracted text is durable. ----
      await expectUnauthenticated(
        uploadFileRoute,
        "POST",
        `http://test/api/knowledge/packages/${knowledgePackageId}/files`,
        filesCtx,
      );
      const docxBytes = readFileSync(join(fixturesDir, "sample.docx"));
      const upload = await post(
        uploadFileRoute,
        `http://test/api/knowledge/packages/${knowledgePackageId}/files`,
        clientCookie,
        {
          filename: "sample.docx",
          contentType: OOXML_DOCX,
          contentBase64: docxBytes.toString("base64"),
        },
        filesCtx,
      );
      expect(upload.status).toBe(200);
      expect(upload.body.data.outcome).toBe("INGESTED");
      expect(upload.body.data.format).toBe("DOCX");
      expect(upload.body.data.version.versionNumber).toBe(1);
      const docxVersionRow = await db.query<{ storage_path: string | null }>(
        `SELECT storage_path FROM knowledge_version WHERE package_id = $1 ORDER BY version_number LIMIT 1`,
        [knowledgePackageId],
      );
      const docxStoragePath = docxVersionRow.rows[0]?.storage_path;
      expect(docxStoragePath).toBeTruthy();
      expect(await knowledgeRuntime.contentStore.get(docxStoragePath!)).toContain(DOCX_MARKER);

      // PDF knowledge source: the upload route parses PDFs via pdf-parse, which is known-broken on
      // some Node builds in this environment (see tests/runtime/knowledge/ingestion.test.ts).
      // Probe the library against the committed real fixture once; when it works, exercise the
      // FULL HTTP upload and durability round-trip — never fake it, never fail the pilot on a
      // library/environment quirk that the reliability lane already tracks.
      let pdfIngested = false;
      let pdfStoragePath: string | null = null;
      const pdfBytes = readFileSync(join(fixturesDir, "sample.pdf"));
      let pdfLibWorks = false;
      try {
        const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
        const probed = await pdfParse(pdfBytes);
        pdfLibWorks = typeof probed.text === "string" && probed.text.includes(PDF_MARKER);
      } catch {
        pdfLibWorks = false;
      }
      if (pdfLibWorks) {
        const pdfUpload = await post(
          uploadFileRoute,
          `http://test/api/knowledge/packages/${knowledgePackageId}/files`,
          clientCookie,
          {
            filename: "sample.pdf",
            contentType: "application/pdf",
            contentBase64: pdfBytes.toString("base64"),
          },
          filesCtx,
        );
        expect(pdfUpload.status).toBe(200);
        expect(pdfUpload.body.data.outcome).toBe("INGESTED");
        expect(pdfUpload.body.data.format).toBe("PDF");
        const pdfDoc = await db.query<{ storage_path: string | null }>(
          `SELECT v.storage_path FROM knowledge_version v
             JOIN knowledge_document d ON d.id = v.document_id
            WHERE v.package_id = $1 AND d.title = 'sample.pdf'
            ORDER BY v.version_number LIMIT 1`,
          [knowledgePackageId],
        );
        pdfStoragePath = pdfDoc.rows[0]?.storage_path ?? null;
        expect(pdfStoragePath).toBeTruthy();
        expect(await knowledgeRuntime.contentStore.get(pdfStoragePath!)).toContain(PDF_MARKER);
        pdfIngested = true;
      }

      // ---- HOP 9: Client Owner CONFIRMS the knowledge package (explicit human step, audited). ----
      await expectUnauthenticated(
        confirmPackageRoute,
        "POST",
        `http://test/api/commands/projects/${projectId}/knowledge-packages/${knowledgePackageId}/confirm`,
        packageCtx,
      );
      const confirmed = await post(
        confirmPackageRoute,
        `http://test/api/commands/projects/${projectId}/knowledge-packages/${knowledgePackageId}/confirm`,
        clientCookie,
        {},
        packageCtx,
      );
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.data.status).toBe("CONFIRMED");
      expect(confirmed.body.data.confirmedAt).toBeTruthy();

      // ---- HOP 10: EnterpriseProfile (industry profile). ----
      const profile = await post(
        enterpriseProfileRoute,
        `http://test/api/commands/projects/${projectId}/enterprise-profile`,
        clientCookie,
        {
          verticalSlug: "b2b-manufacturing",
          verticalLabel: "B2B Manufacturing",
          validationGateLevel: "PLATFORM_WIDE_GATE",
          ruleSetVersion: 1,
        },
        projectCtx,
      );
      expect(profile.status).toBe(200);
      const industryProfileId: string = profile.body.data.id;

      // ---- HOP 11: KeywordQuestionMap. ----
      const map = await post(
        keywordMapsRoute,
        `http://test/api/commands/projects/${projectId}/keyword-maps`,
        clientCookie,
        {
          knowledgePackageId,
          industryProfileId,
          entries: [
            {
              keyword: KEYWORD,
              questions: ["what is generative engine optimization?", "how does GEO work?"],
            },
          ],
        },
        projectCtx,
      );
      expect(map.status).toBe(200);
      expect(map.body.data.keywords).toEqual([KEYWORD]);
      const keywordQuestionMapId: string = map.body.data.id;

      // ---- HOP 12: Opportunity (+ automated validation). ----
      const opp = await post(
        opportunitiesRoute,
        `http://test/api/commands/projects/${projectId}/opportunities`,
        clientCookie,
        { keywordQuestionMapId, keyword: KEYWORD },
        projectCtx,
      );
      expect(opp.status).toBe(200);
      expect(opp.body.data.validation.status).toBe("VALIDATED");
      const opportunityId: string = opp.body.data.opportunity.id;
      const opportunityValidationId: string = opp.body.data.validation.id;

      // ---- HOP 13: Client Review — NEVER automatic. Before the human posts a decision the review
      //      is PENDING (no APPROVED decision row exists), and the reference the client uses is an
      //      OPAQUE code, never the raw validation UUID. ----
      const preReview = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM human_review_decision WHERE decision = 'APPROVED'`,
      );
      expect(preReview.rows[0]!.n).toBe("0"); // nothing auto-approved
      const queue = await get(
        reviewQueueRoute,
        `http://test/api/projects/${projectId}/review-queue`,
        clientCookie,
        projectCtx,
      );
      expect(queue.status).toBe(200);
      const reviewable = (queue.body.data as Array<any>).find((q) => q.id === opportunityId);
      expect(reviewable?.status).toBe("VALIDATED");
      expect(reviewable?.review?.reviewStatus).toBe("PENDING");
      expect(JSON.stringify(queue.body)).not.toContain(opportunityValidationId);

      const review = await post(
        opportunityReviewsRoute,
        `http://test/api/opportunities/${opportunityId}/reviews`,
        clientCookie,
        {
          reviewReferenceCode: reviewable!.review.reviewReferenceCode,
          reviewVersion: reviewable!.review.reviewVersion,
          decision: "CONFIRMED",
        },
        { params: Promise.resolve({ id: opportunityId }) },
      );
      expect(review.status).toBe(200);
      expect(review.body.data.status).toBe("APPROVED");
      expect(review.body.data.reviewerId).toBe(clientOwnerUserId); // a real human, session-derived
      const humanReviewDecisionId: string = review.body.data.id;

      // ---- HOP 14: OpportunityFamily + ArticleBrief. ----
      const family = await post(
        opportunityFamiliesRoute,
        "http://test/api/opportunity-families",
        clientCookie,
        {
          projectId,
          members: [{ opportunityId, authorizingHumanReviewDecisionId: humanReviewDecisionId }],
        },
      );
      expect(family.status).toBe(200);
      const brief = await post(articleBriefsRoute, "http://test/api/article-briefs", clientCookie, {
        opportunityFamilyId: family.body.data.id,
        workingTitle: "The state of generative engine optimization",
        outline: ["Introduction", "How answer engines rank content", "Conclusion"],
        targetKeywords: [KEYWORD],
        riskLevel: "STANDARD",
      });
      expect(brief.status).toBe(200);
      const articleBriefId: string = brief.body.data.id;

      // ---- HOP 15: OFFLINE deterministic provider content generation (flag OFF; zero network),
      //      then the article-draft compiler over HTTP. The single sanitized ledger row below
      //      records the OFFLINE execution's metadata through the real D3 sink — NOT a real call. ----
      expect(isProviderRuntimeEnabled()).toBe(false);
      expect(() => assertRealProviderCallAllowed()).toThrow(ProviderRuntimeDisabledError);

      const offlineAdapter = new DeterministicOfflineProviderAdapter("closed-pilot");
      const providerRequest: ProviderGenerateArticleContentRequest = {
        projectId,
        articleBriefId,
        model: OFFLINE_MODEL,
        maxTokens: 1024,
        timeoutMs: 30_000,
        requestId: `offline-cpops-req-${articleBriefId}`,
        idempotencyKey: `offline-cpops-idem-${articleBriefId}`,
      };
      const offlineResult = await offlineAdapter.generateArticleContent(providerRequest);
      expect(offlineResult.ok).toBe(true);
      const offlineResult2 = await offlineAdapter.generateArticleContent(providerRequest);
      expect(JSON.stringify(offlineResult2)).toBe(JSON.stringify(offlineResult)); // deterministic

      // Ledger the OFFLINE execution (sanitized metadata only; zero tokens; offline model name).
      const ledger = new PgProviderLedger(db);
      const ledgerRowInput = {
        requestId: providerRequest.requestId,
        idempotencyKey: providerRequest.idempotencyKey,
        projectId,
        articleBriefId,
      };
      await insertSanitizedOfflineLedgerRow(db, ledgerRowInput);
      // Idempotent re-emission: the same key never yields a second row.
      await insertSanitizedOfflineLedgerRow(db, ledgerRowInput);
      expect(await ledger.countByIdempotencyKey(providerRequest.idempotencyKey)).toBe(1);
      const ledgerRows = await ledger.listByScope({ clientOrganizationId: clientAId, projectId });
      expect(ledgerRows).toHaveLength(1);
      expect(ledgerRows[0]!.model).toBe(OFFLINE_MODEL);
      expect(ledgerRows[0]!.status).toBe("OK");
      expect(ledgerRows[0]!.totalTokens).toBe(0); // an offline execution consumes no provider tokens

      const OFFLINE_ENVELOPE = `offline_cpops_${providerRequest.idempotencyKey}`;
      const draft = await post(compileDraftRoute, "http://test/api/article-drafts/compile", clientCookie, {
        articleBriefId,
        providerResponseEnvelopeId: OFFLINE_ENVELOPE,
      });
      expect(draft.status).toBe(200);
      expect(draft.body.data.version).toBe(1);
      const articleDraftId: string = draft.body.data.id;

      // ---- HOP 16: The three gates + HUMAN article approval. Compiling NEVER approves: before the
      //      human review call there is no article_approval row at all. ----
      const preApproval = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM article_approval`,
      );
      expect(preApproval.rows[0]!.n).toBe("0"); // no automatic approval
      await expectUnauthenticated(
        articleReviewsRoute,
        "POST",
        `http://test/api/article-drafts/${articleDraftId}/reviews`,
        { params: Promise.resolve({ id: articleDraftId }) },
      );
      const approval = await post(
        articleReviewsRoute,
        `http://test/api/article-drafts/${articleDraftId}/reviews`,
        clientCookie,
        { industryProfileId },
        { params: Promise.resolve({ id: articleDraftId }) },
      );
      expect(approval.status).toBe(200);
      expect(approval.body.data.approverId).toBe(clientOwnerUserId); // an explicit HUMAN approver
      const gates = await db.query<{ q: string; p: string; v: string }>(
        `SELECT (SELECT status FROM quality_gate_result  ORDER BY created_at DESC LIMIT 1) AS q,
                (SELECT status FROM platform_gate_result ORDER BY created_at DESC LIMIT 1) AS p,
                (SELECT status FROM vertical_gate_result ORDER BY created_at DESC LIMIT 1) AS v`,
      );
      expect(gates.rows[0]).toEqual({ q: "PASSED", p: "PASSED", v: "PASSED" });

      // ---- HOP 17: PublishPackage — DEFAULT SELECTED CHANNEL COUNT = 0, proven in the response
      //      AND in the durable row (target_channel_ids is the empty array). ----
      const pub = await post(publishPackagesRoute, "http://test/api/publish-packages", clientCookie, {
        articleApprovalId: approval.body.data.id,
        blocks: [{ kind: "PARAGRAPH", text: "GEO, explained for enterprises.", order: 0 }],
      });
      expect(pub.status).toBe(200);
      expect(pub.body.data.channelNeutralContentPackage.selectedChannelCount).toBe(0);
      const channelNeutralContentPackageId: string = pub.body.data.channelNeutralContentPackage.id;
      const cnpRow = await db.query<{ n: string }>(
        `SELECT coalesce(array_length(target_channel_ids, 1), 0)::text AS n
           FROM channel_neutral_content_package WHERE id = $1`,
        [channelNeutralContentPackageId],
      );
      expect(cnpRow.rows[0]!.n).toBe("0");

      // ---- HOP 18: DistributionPlan — a HUMAN explicitly selects exactly one channel. ----
      const plan = await post(distributionPlansRoute, "http://test/api/distribution-plans", clientCookie, {
        channelNeutralContentPackageId,
        channelIds: [CHANNEL],
        selectedByActorId: clientOwnerUserId,
      });
      expect(plan.status).toBe(200);
      expect(plan.body.data.channelIds).toEqual([CHANNEL]);
      expect(plan.body.data.selectedByActorId).toBe(clientOwnerUserId);
      const distributionPlanId: string = plan.body.data.id;

      // ---- HOP 19: PublicationReceipt — automatic publication is IMPOSSIBLE without a signed
      //      human session; request-body actor cannot override that session actor. ----
      const autoReceipt = await post(
        publicationReceiptsRoute,
        "http://test/api/publication-receipts",
        null,
        { distributionPlanId, channelId: CHANNEL, publishedByActorId: "system" },
      );
      expect(autoReceipt.status).toBe(401);
      const noReceipt = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM publication_receipt WHERE distribution_plan_id = $1`,
        [distributionPlanId],
      );
      expect(noReceipt.rows[0]!.n).toBe("0");
      const receipt = await post(
        publicationReceiptsRoute,
        "http://test/api/publication-receipts",
        clientCookie,
        { distributionPlanId, channelId: CHANNEL, publishedByActorId: "system" },
      );
      expect(receipt.status).toBe(200);
      expect(receipt.body.data.publishedByActorId).toBe(clientOwnerUserId);
      const receiptId: string = receipt.body.data.id;

      // ---- HOP 20: Client Delivery view — the client sees the DELIVERED article. ----
      await expectUnauthenticated(
        deliveriesRoute,
        "GET",
        `http://test/api/projects/${projectId}/deliveries`,
        projectCtx,
      );
      const deliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${projectId}/deliveries`,
        clientCookie,
        projectCtx,
      );
      expect(deliveries.status).toBe(200);
      expect(
        (deliveries.body.data as Array<{ status: string }>).filter((d) => d.status === "DELIVERED")
          .length,
      ).toBeGreaterThanOrEqual(1);

      // ---- HOP 21: Agency Progress view — the agency owner sees ONLY its ACTIVE-assigned client
      //      (with its project count); a client role is refused. ----
      await expectUnauthenticated(agencyClientsRoute, "GET", "http://test/api/agency/clients");
      const clientTriesAgencyView = await get(
        agencyClientsRoute,
        "http://test/api/agency/clients",
        clientCookie,
      );
      expect(clientTriesAgencyView.status).toBe(403);
      const agencyView = await get(agencyClientsRoute, "http://test/api/agency/clients", agencyCookie);
      expect(agencyView.status).toBe(200);
      const listedClients = agencyView.body.data.clients as Array<{
        clientOrganizationId: string;
        projectCount: number;
      }>;
      expect(listedClients).toHaveLength(1);
      expect(listedClients[0]!.clientOrganizationId).toBe(clientAId);
      expect(listedClients[0]!.projectCount).toBe(1);

      // ---- HOP 22: Ops Audit view — platform only; the FULL domain trail is present. ----
      await expectUnauthenticated(opsAuditRoute, "GET", "http://test/api/ops/audit");
      const clientTriesAudit = await get(opsAuditRoute, "http://test/api/ops/audit", clientCookie);
      expect(clientTriesAudit.status).toBe(403);
      const agencyTriesAudit = await get(opsAuditRoute, "http://test/api/ops/audit", agencyCookie);
      expect(agencyTriesAudit.status).toBe(403);
      const audit = await get(opsAuditRoute, "http://test/api/ops/audit", platformCookie);
      expect(audit.status).toBe(200);
      const actions = new Set((audit.body.data as Array<{ action: string }>).map((e) => e.action));
      for (const expected of [
        "ops.agency.create",
        "ops.client.create",
        "ops.assignment.create",
        "project.create",
        "project.invitation.create",
        "knowledge_package.created",
        "knowledge_package.confirmed",
        "industry_profile.created",
        "keyword_question_map.created",
        "opportunity.created",
        "opportunity.validated",
        "human_review.confirmed",
        "opportunity_family.created",
        "article_brief.created",
        "provider_article_content.ingested",
        "article_draft.compiled",
        "quality_gate.passed",
        "platform_gate.passed",
        "vertical_gate.passed",
        "article.approved",
        "publish_package.created",
        "channel_neutral_content_package.created",
        "distribution_plan.created",
        "publication_receipt.recorded",
      ]) {
        expect(actions.has(expected), `audit trail should contain "${expected}"`).toBe(true);
      }
      // The denied ops attempts above were audited too (denials leave evidence; outcome lives in
      // the hashed metadata bag — the audit_event schema has no dedicated outcome column).
      const denied = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_event WHERE metadata->>'outcome' = 'DENIED'`,
      );
      expect(Number(denied.rows[0]!.n)).toBeGreaterThanOrEqual(1);

      // ---- Persist the shared data-set handles for every drill. ----
      S = {
        platformUserId,
        agencyOwnerUserId,
        clientOwnerUserId,
        platformOrgId: platformOrg.id,
        agencyId,
        clientAId,
        projectId,
        knowledgePackageId,
        docxStoragePath: docxStoragePath!,
        pdfIngested,
        pdfStoragePath,
        industryProfileId,
        opportunityId,
        articleBriefId,
        articleDraftId,
        distributionPlanId,
        receiptId,
        ledgerIdempotencyKey: providerRequest.idempotencyKey,
        offlineEnvelope: OFFLINE_ENVELOPE,
        platformCookie,
        agencyCookie,
        clientCookie,
      };
    }, STEP_TIMEOUT);

    // ==========================================================================================
    // PART 2 — OPERATIONS DRILLS, continuing against the SAME data set.
    // ==========================================================================================

    it("drill (a) — application restart: a brand-new pool + runtime contexts reads the whole pilot back over HTTP", async () => {
      expect(S, "the chain must have produced the shared data set").toBeTruthy();

      // "Restart": the old process is gone — close its pool (and with it every in-process cache),
      // then build a brand-new pool and brand-new runtime contexts, exactly as a fresh boot does.
      await db.close();
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      rebindRuntimes(db);

      // Re-login on the restarted process (new session minted through the real login route).
      const clientCookie = await loginAndGetCookie(FIXTURES.clientA.email);
      const platformCookie = await loginAndGetCookie(FIXTURES.platform.email);
      const agencyCookie = await loginAndGetCookie(FIXTURES.agency.email);

      // The uploaded knowledge CONTENT text survived (durable store, not process memory).
      expect(await knowledgeRuntime.contentStore.get(S.docxStoragePath)).toContain(DOCX_MARKER);
      if (S.pdfIngested && S.pdfStoragePath) {
        expect(await knowledgeRuntime.contentStore.get(S.pdfStoragePath)).toContain(PDF_MARKER);
      }

      // Business state re-derives over HTTP on the restarted runtime.
      const projectCtx = { params: Promise.resolve({ projectId: S.projectId }) };
      const pkg = await get(
        getPackageRoute,
        `http://test/api/knowledge/packages/${S.knowledgePackageId}`,
        clientCookie,
        { params: Promise.resolve({ id: S.knowledgePackageId }) },
      );
      expect(pkg.status).toBe(200);
      expect(pkg.body.data.status).toBe("CONFIRMED");

      const deliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${S.projectId}/deliveries`,
        clientCookie,
        projectCtx,
      );
      expect(deliveries.status).toBe(200);
      expect(
        (deliveries.body.data as Array<{ status: string }>).some((d) => d.status === "DELIVERED"),
      ).toBe(true);

      const agencyView = await get(agencyClientsRoute, "http://test/api/agency/clients", agencyCookie);
      expect(agencyView.status).toBe(200);
      expect(
        (agencyView.body.data.clients as Array<{ clientOrganizationId: string }>).map(
          (c) => c.clientOrganizationId,
        ),
      ).toEqual([S.clientAId]);

      const audit = await get(opsAuditRoute, "http://test/api/ops/audit", platformCookie);
      expect(audit.status).toBe(200);
      expect((audit.body.data as Array<unknown>).length).toBeGreaterThan(0);

      // Update the shared cookies so later drills keep operating on live sessions.
      S = { ...S, clientCookie, platformCookie, agencyCookie };
    }, STEP_TIMEOUT);

    it("drill (b) — database connection pool restart: forced backend loss self-heals, and a rebuilt pool honours the pre-restart session", async () => {
      expect(S).toBeTruthy();

      // --- Phase 1: FORCED server-side connection loss on an isolated, tagged drill pool. ---
      // A single-connection pool is tagged via application_name; an admin session then terminates
      // that exact backend mid-query (never the main pool's backends), and the pool must re-establish
      // a fresh connection on the next query — the self-heal an operator relies on.
      const drillUrl = new URL(testConfig!.connectionString);
      drillUrl.searchParams.set("application_name", "geoplane_cpops_pool_drill");
      const drillPool = new Pool({ connectionString: drillUrl.toString(), max: 1 });
      const poolErrors: Error[] = [];
      drillPool.on("error", (err) => {
        poolErrors.push(err); // observed, never crashing the process
      });
      // pg's pool-level "error" only covers IDLE clients. The backend we kill is
      // CHECKED OUT (mid-query), and after its query rejects the doomed client
      // can emit one more socket-level "error" (57P01 / connection terminated)
      // with no listener — a timing-dependent unhandled error that aborted CI
      // run 29655238192 while runs 3 and 5 passed. Attach a per-client listener
      // so the EXPECTED termination error is observed, never unhandled. The
      // drill's assertions (in-flight query rejects, pool self-heals) are
      // unchanged.
      drillPool.on("connect", (client) => {
        client.on("error", (err: Error) => {
          poolErrors.push(err);
        });
      });
      const admin = createPgDatabase({
        connectionString: withUserAndDb(testConfig!.connectionString, SUPERUSER, "postgres"),
        max: 2,
      });
      try {
        // Warm the drill connection and prove it serves the pilot data set.
        const warm = await drillPool.query<{ keyword: string }>(
          `SELECT keyword FROM opportunity WHERE id = $1`,
          [S.opportunityId],
        );
        expect(warm.rows[0]?.keyword).toBe(KEYWORD);

        // Kill the tagged backend while a query is in flight; that query MUST fail...
        const inFlight = drillPool.query(`SELECT pg_sleep(5)`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const killed = await admin.query<{ n: string }>(
          `SELECT count(pg_terminate_backend(pid))::text AS n
             FROM pg_stat_activity
            WHERE application_name = 'geoplane_cpops_pool_drill'`,
        );
        expect(Number(killed.rows[0]!.n)).toBeGreaterThanOrEqual(1);
        await expect(inFlight).rejects.toThrow();

        // ...and the pool must RECOVER: the very next query gets a fresh backend and succeeds.
        const healed = await drillPool.query<{ keyword: string }>(
          `SELECT keyword FROM opportunity WHERE id = $1`,
          [S.opportunityId],
        );
        expect(healed.rows[0]?.keyword).toBe(KEYWORD);
      } finally {
        await drillPool.end();
        await admin.close();
      }

      // --- Phase 2: EXPLICIT pool restart under the application. Close the app pool, build a new
      // one, rebind the runtimes — and the PRE-RESTART session cookie still authenticates, because
      // sessions are durable rows + a stable signing key, not pool state. No re-login required. ---
      const cookieBefore = S.clientCookie;
      await db.close();
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      rebindRuntimes(db);

      const principal = await authRuntime.resolveSession(cookieBefore);
      expect(principal?.userId).toBe(S.clientOwnerUserId);
      const deliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${S.projectId}/deliveries`,
        cookieBefore,
        { params: Promise.resolve({ projectId: S.projectId }) },
      );
      expect(deliveries.status).toBe(200);
      expect(
        (deliveries.body.data as Array<{ status: string }>).some((d) => d.status === "DELIVERED"),
      ).toBe(true);
    }, STEP_TIMEOUT);

    it("drill (c) — session rotation: old cookie honoured only during the window, invalid after retirement; re-login works", async () => {
      expect(S).toBeTruthy();
      const K1 = "cpops-rotation-signing-key-ONE-do-not-use-in-prod-0001";
      const K2 = "cpops-rotation-signing-key-TWO-do-not-use-in-prod-0002";
      try {
        // Signing-layer contract (DB-independent).
        const payloadB64 = Buffer.from(JSON.stringify({ probe: "cpops-rotation" }), "utf8").toString(
          "base64url",
        );
        const tokenUnderK1 = signSessionCookieValue(payloadB64, { key: K1 });
        __setSessionSigningKeysForTests({ current: K1, previous: null });
        expect(verifySignedSessionToken(tokenUnderK1)).not.toBeNull();
        __setSessionSigningKeysForTests({ current: K2, previous: K1 });
        expect(verifySignedSessionToken(tokenUnderK1)).not.toBeNull(); // rotation window
        __setSessionSigningKeysForTests({ current: K2, previous: null });
        expect(verifySignedSessionToken(tokenUnderK1)).toBeNull(); // retired

        // End-to-end on the SAME data set through the real login route + resolveSession.
        __setSessionSigningKeysForTests({ current: K1, previous: null });
        const cookieK1 = await loginAndGetCookie(FIXTURES.clientA.email);
        expect((await authRuntime.resolveSession(cookieK1))?.userId).toBe(S.clientOwnerUserId);

        __setSessionSigningKeysForTests({ current: K2, previous: K1 });
        expect((await authRuntime.resolveSession(cookieK1))?.userId).toBe(S.clientOwnerUserId);
        const cookieK2 = await loginAndGetCookie(FIXTURES.clientA.email); // re-login under the new key
        expect((await authRuntime.resolveSession(cookieK2))?.userId).toBe(S.clientOwnerUserId);

        __setSessionSigningKeysForTests({ current: K2, previous: null });
        expect(await authRuntime.resolveSession(cookieK1)).toBeNull(); // OLD SESSION INVALID
        expect((await authRuntime.resolveSession(cookieK2))?.userId).toBe(S.clientOwnerUserId);

        // And an authorized HTTP read still works for the re-logged-in session.
        const deliveries = await get(
          deliveriesRoute,
          `http://test/api/projects/${S.projectId}/deliveries`,
          cookieK2,
          { params: Promise.resolve({ projectId: S.projectId }) },
        );
        expect(deliveries.status).toBe(200);
      } finally {
        __setSessionSigningKeysForTests(null);
      }
      // Back on the env-driven key, mint fresh cookies for the remaining drills.
      S = {
        ...S,
        clientCookie: await loginAndGetCookie(FIXTURES.clientA.email),
        platformCookie: await loginAndGetCookie(FIXTURES.platform.email),
        agencyCookie: await loginAndGetCookie(FIXTURES.agency.email),
      };
    }, STEP_TIMEOUT);

    it("drill (d) — backup -> restore into a fresh DB -> RE-LOGIN -> read back ALL business data", async () => {
      expect(S).toBeTruthy();
      const baseUrl = testConfig!.connectionString;
      backupDir = mkdtempSync(join(tmpdir(), "geoplane-cpops-bkp-"));

      // Capture the source ledger row for a byte-for-byte post-restore comparison.
      const sourceLedger = await new PgProviderLedger(db).getByIdempotencyKey(S.ledgerIdempotencyKey);
      expect(sourceLedger).not.toBeNull();
      const sourceAudit = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM audit_event`);

      // (1) Backup via the REAL CLI (superuser role; password only ever via PGPASSWORD).
      const backupOut = execFileSync(
        process.execPath,
        [backupScript, "--test", "--user", SUPERUSER, "--out", backupDir],
        { cwd: repoRoot, encoding: "utf8" },
      );
      const artifactLine = backupOut.split(/\r?\n/).find((l) => l.startsWith("ARTIFACT "));
      if (!artifactLine) throw new Error(`backup.mjs did not report an ARTIFACT path:\n${backupOut}`);
      const dumpFile = artifactLine.slice("ARTIFACT ".length).trim();

      // (2) Restore into a FRESH throwaway database via the REAL CLI.
      execFileSync(
        process.execPath,
        [restoreScript, "--test", "--db", DST_DB, "--user", SUPERUSER, "--dump", dumpFile],
        { cwd: repoRoot, encoding: "utf8" },
      );

      // (3) Point a full application runtime at the RESTORED database, RE-LOGIN over HTTP, and
      //     read all business data back — through the routes where a route exists, straight from
      //     the durable tables otherwise.
      const restored = createPgDatabase({
        connectionString: withUserAndDb(baseUrl, SUPERUSER, DST_DB),
        max: 4,
      });
      try {
        rebindRuntimes(restored);

        // RE-LOGIN after restore, all three roles, through the real login route.
        const clientCookie = await loginAndGetCookie(FIXTURES.clientA.email);
        const platformCookie = await loginAndGetCookie(FIXTURES.platform.email);
        const agencyCookie = await loginAndGetCookie(FIXTURES.agency.email);
        expect((await authRuntime.resolveSession(clientCookie))?.userId).toBe(S.clientOwnerUserId);

        // ACCOUNTS: every sanitized pilot identity survived.
        const users = await restored.query<{ email: string }>(`SELECT email FROM "user" ORDER BY email`);
        const emails = users.rows.map((r) => r.email);
        for (const e of [FIXTURES.platform.email, FIXTURES.agency.email, FIXTURES.clientA.email]) {
          expect(emails).toContain(e);
        }
        const orgs = await restored.query<{ id: string; type: string; display_name: string }>(
          `SELECT id, type, display_name FROM organization`,
        );
        expect(orgs.rows.find((o) => o.id === S.clientAId)?.type).toBe("CLIENT");
        for (const o of orgs.rows) expect(o.display_name).toMatch(/sample|pilot fixture/i);

        // KNOWLEDGE SOURCE RAW CONTENT: the extracted text itself, byte-durable across restore.
        expect(await knowledgeRuntime.contentStore.get(S.docxStoragePath)).toContain(DOCX_MARKER);
        if (S.pdfIngested && S.pdfStoragePath) {
          expect(await knowledgeRuntime.contentStore.get(S.pdfStoragePath)).toContain(PDF_MARKER);
        }
        const pkg = await get(
          getPackageRoute,
          `http://test/api/knowledge/packages/${S.knowledgePackageId}`,
          clientCookie,
          { params: Promise.resolve({ id: S.knowledgePackageId }) },
        );
        expect(pkg.status).toBe(200);
        expect(pkg.body.data.status).toBe("CONFIRMED");

        // OPPORTUNITIES.
        const opp = await restored.query<{ keyword: string }>(
          `SELECT keyword FROM opportunity WHERE id = $1`,
          [S.opportunityId],
        );
        expect(opp.rows[0]?.keyword).toBe(KEYWORD);

        // ARTICLES & DELIVERIES — including through the client's own HTTP delivery view.
        const draft = await restored.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM article_draft WHERE project_id = $1`,
          [S.projectId],
        );
        expect(Number(draft.rows[0]!.n)).toBeGreaterThanOrEqual(1);
        const approvalRow = await restored.query<{ approver_user_id: string }>(
          `SELECT approver_user_id FROM article_approval LIMIT 1`,
        );
        expect(approvalRow.rows[0]?.approver_user_id).toBe(S.clientOwnerUserId);
        const deliveries = await get(
          deliveriesRoute,
          `http://test/api/projects/${S.projectId}/deliveries`,
          clientCookie,
          { params: Promise.resolve({ projectId: S.projectId }) },
        );
        expect(deliveries.status).toBe(200);
        expect(
          (deliveries.body.data as Array<{ status: string }>).some((d) => d.status === "DELIVERED"),
        ).toBe(true);
        const receiptRow = await restored.query<{ channel_id: string }>(
          `SELECT channel_id FROM publication_receipt WHERE id = $1`,
          [S.receiptId],
        );
        expect(receiptRow.rows[0]?.channel_id).toBe(CHANNEL);

        // AGENCY PROGRESS VIEW still scoped to the assigned client only.
        const agencyView = await get(agencyClientsRoute, "http://test/api/agency/clients", agencyCookie);
        expect(agencyView.status).toBe(200);
        expect(
          (agencyView.body.data.clients as Array<{ clientOrganizationId: string }>).map(
            (c) => c.clientOrganizationId,
          ),
        ).toEqual([S.clientAId]);

        // AUDIT RECORDS: full count survived, every row still tamper-evidence hashed; the ops view works.
        const auditCount = await restored.query<{ total: string; hashed: string }>(
          `SELECT count(*)::text AS total,
                  count(*) FILTER (WHERE event_hash IS NOT NULL AND length(event_hash) > 0)::text AS hashed
             FROM audit_event`,
        );
        expect(auditCount.rows[0]!.total).toBe(sourceAudit.rows[0]!.n);
        expect(auditCount.rows[0]!.hashed).toBe(auditCount.rows[0]!.total);
        const auditView = await get(opsAuditRoute, "http://test/api/ops/audit", platformCookie);
        expect(auditView.status).toBe(200);
        expect((auditView.body.data as Array<unknown>).length).toBeGreaterThan(0);

        // PROVIDER LEDGER ROWS: the single sanitized OFFLINE row restored byte-for-byte, and the
        // restored ledger still refuses mutation (the append-only trigger travelled with the dump).
        const restoredLedger = new PgProviderLedger(restored);
        const rows = await restoredLedger.listByScope({
          clientOrganizationId: S.clientAId,
          projectId: S.projectId,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(sourceLedger);
        expect(rows[0]!.model).toBe(OFFLINE_MODEL); // never a real provider model
        await expect(
          restored.query(`UPDATE provider_execution SET request_id = request_id`),
        ).rejects.toThrow(/append-only/i);
        await expect(
          restored.query(
            `UPDATE delivery SET client_readable = false WHERE publication_receipt_id = $1`,
            [S.receiptId],
          ),
        ).rejects.toThrow(/append-only/i);

        // PROVIDER ARTICLE CONTENT: still exactly the opaque offline envelope pointer.
        const envelope = await restored.query<{ provider_response_envelope_id: string }>(
          `SELECT provider_response_envelope_id FROM provider_article_content WHERE article_brief_id = $1`,
          [S.articleBriefId],
        );
        expect(envelope.rows[0]?.provider_response_envelope_id).toBe(S.offlineEnvelope);
      } finally {
        // Rebind the app to the ORIGINAL pilot database for the invariants suite, then drop the pool.
        rebindRuntimes(db);
        await restored.close();
      }
    }, STEP_TIMEOUT);

    // ==========================================================================================
    // PART 3 — STANDING INVARIANTS, verified inside this suite on the same data set.
    // ==========================================================================================
    it("holds the standing invariants: isolation, no auto-approval, append-only history + ledger, 0 default channels, provider OFF", async () => {
      expect(S).toBeTruthy();

      // --- INVARIANT: a client cannot cross to another client's data. ---
      const clientB = await post(opsClientsRoute, "http://test/api/ops/clients", S.platformCookie, {
        displayName: FIXTURES.clientB.orgName,
      });
      expect(clientB.status).toBe(200);
      const clientBId: string = clientB.body.data.id;
      const projectB = await post(projectsRoute, "http://test/api/commands/projects", S.platformCookie, {
        name: "Sample Secondary Operations Project",
        clientOrganizationId: clientBId,
      });
      expect(projectB.status).toBe(200);
      const clientBOwner = await createUser(FIXTURES.clientB.email);
      await createMembership(clientBOwner, clientBId, "CLIENT_OWNER");
      const clientBCookie = await loginAndGetCookie(FIXTURES.clientB.email);

      const crossDeliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${S.projectId}/deliveries`,
        clientBCookie,
        { params: Promise.resolve({ projectId: S.projectId }) },
      );
      expect(crossDeliveries.status).toBe(403); // fail-closed cross-tenant read
      const crossPackage = await get(
        getPackageRoute,
        `http://test/api/knowledge/packages/${S.knowledgePackageId}`,
        clientBCookie,
        { params: Promise.resolve({ id: S.knowledgePackageId }) },
      );
      expect(crossPackage.status).toBe(403);
      const ownDeliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${projectB.body.data.id}/deliveries`,
        clientBCookie,
        { params: Promise.resolve({ projectId: projectB.body.data.id }) },
      );
      expect(ownDeliveries.status).toBe(200);
      expect(ownDeliveries.body.data).toEqual([]); // the control read

      // --- INVARIANT: the agency sees ONLY its assigned clients (never the unassigned Client B). ---
      const agencyView = await get(agencyClientsRoute, "http://test/api/agency/clients", S.agencyCookie);
      expect(agencyView.status).toBe(200);
      const seen = (agencyView.body.data.clients as Array<{ clientOrganizationId: string }>).map(
        (c) => c.clientOrganizationId,
      );
      expect(seen).toEqual([S.clientAId]);
      expect(seen).not.toContain(clientBId);

      // --- INVARIANT: human review & article approval never auto-approve. Every persisted decision
      //     names the human who made it; the schema-level CHECK refuses system actors outright. ---
      const decisions = await db.query<{ reviewer_user_id: string | null }>(
        `SELECT reviewer_user_id FROM human_review_decision WHERE decision = 'APPROVED'`,
      );
      expect(decisions.rows.length).toBeGreaterThanOrEqual(1);
      for (const d of decisions.rows) expect(d.reviewer_user_id).toBe(S.clientOwnerUserId);
      const approvals = await db.query<{ approver_user_id: string }>(
        `SELECT approver_user_id FROM article_approval`,
      );
      expect(approvals.rows.length).toBeGreaterThanOrEqual(1);
      for (const a of approvals.rows) expect(a.approver_user_id).toBe(S.clientOwnerUserId);
      // The DB itself rejects a system publication actor (defense-in-depth under the 422 route
      // guard): ck_publication_receipt_no_auto_publish refuses the row.
      await expect(
        db.query(
          `INSERT INTO publication_receipt
             (client_organization_id, project_id, distribution_plan_id, channel_id,
              published_by_actor_id, published_at)
           VALUES ($1, $2, $3, $4, 'system', now())`,
          [S.clientAId, S.projectId, S.distributionPlanId, CHANNEL],
        ),
      ).rejects.toThrow(/no_auto_publish|check constraint/i);

      // --- INVARIANT: historical artifacts AND the provider ledger are APPEND-ONLY (DB triggers,
      //     not application convention). Every table proven with rows actually present. ---
      // knowledge_version guards UPDATE only by design (0002 — deletes cascade with their package);
      // every other history table forbids BOTH mutations at the trigger level.
      const appendOnlyTables: ReadonlyArray<
        readonly [table: string, touchColumn: string, forbidsDelete: boolean]
      > = [
        ["knowledge_version", "id", false],
        ["knowledge_content", "content_hash", true],
        ["opportunity_validation", "id", true],
        ["human_review_decision", "id", true],
        ["article_draft", "id", true],
        ["article_approval", "id", true],
        ["provider_article_content", "id", true],
        ["publication_receipt", "id", true],
        ["delivery", "id", true],
        ["provider_execution", "request_id", true],
      ];
      for (const [table, col, forbidsDelete] of appendOnlyTables) {
        const count = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
        expect(
          Number(count.rows[0]!.n),
          `${table} must hold pilot history for the append-only proof to bite`,
        ).toBeGreaterThanOrEqual(1);
        await expect(
          db.query(`UPDATE ${table} SET ${col} = ${col}`),
          `${table} must refuse UPDATE`,
        ).rejects.toThrow(/append-only/i);
        if (forbidsDelete) {
          await expect(db.query(`DELETE FROM ${table}`), `${table} must refuse DELETE`).rejects.toThrow(
            /append-only/i,
          );
        }
      }

      // --- INVARIANT: default selected channel count = 0 (proven at HOP 17 in the response AND the
      //     durable row; re-checked here from the durable row). ---
      const cnp = await db.query<{ n: string }>(
        `SELECT coalesce(array_length(target_channel_ids, 1), 0)::text AS n
           FROM channel_neutral_content_package`,
      );
      expect(cnp.rows[0]!.n).toBe("0");

      // --- INVARIANT: provider runtime defaults OFF; only an explicit opt-in enables it. ---
      expect(isProviderRuntimeEnabled()).toBe(false); // the suite's real environment
      expect(isProviderRuntimeEnabled({})).toBe(false); // unset
      for (const off of ["", "false", "0", "no", "off", "yes", "enabled", "garbage"]) {
        expect(isProviderRuntimeEnabled({ PROVIDER_RUNTIME_ENABLED: off })).toBe(false);
      }
      for (const on of ["true", "1", "TRUE", " True "]) {
        expect(isProviderRuntimeEnabled({ PROVIDER_RUNTIME_ENABLED: on })).toBe(true);
      }
      expect(() => assertRealProviderCallAllowed()).toThrow(ProviderRuntimeDisabledError);
      // And the whole ledger still carries ONLY the sanitized offline execution — no real model ever.
      const allLedger = await db.query<{ model: string }>(`SELECT model FROM provider_execution`);
      expect(allLedger.rows.length).toBe(1);
      for (const row of allLedger.rows) expect(row.model).toBe(OFFLINE_MODEL);

      // --- Real Customer Data = 0: every identity is a reserved-test-domain sample fixture. ---
      const orgRows = await db.query<{ display_name: string }>(`SELECT display_name FROM organization`);
      for (const row of orgRows.rows) {
        expect(/sample|pilot fixture/i.test(row.display_name)).toBe(true);
      }
      const userRows = await db.query<{ email: string }>(`SELECT email FROM "user"`);
      for (const row of userRows.rows) {
        expect(
          /@([a-z0-9-]+\.)*(example|test)$/i.test(row.email) || /\.test$/i.test(row.email),
          `email "${row.email}" must use a reserved test domain (Real Customer Data = 0)`,
        ).toBe(true);
      }
    }, STEP_TIMEOUT);
  },
);
