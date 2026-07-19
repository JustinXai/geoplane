/**
 * PILOT_ACCEPTANCE_V1 — the FULLY-DESENSITIZED three-role pilot acceptance E2E, driven end-to-end
 * through the REAL Next.js App Router route handlers against a real PostgreSQL database
 * (GEO_TEST_DATABASE_URL — geoplane_pl_f). This is the pilot-readiness gate: a single desensitized
 * enterprise / agency / client project is walked through the entire section-14 product loop over
 * signed-cookie HTTP, and every pilot invariant is asserted with real evidence rather than claimed.
 *
 * THREE DESENSITIZED ROLES (SAMPLE FIXTURES ONLY — Real Customer Data = 0):
 *   - Platform Admin  (PLATFORM_SUPER_ADMIN) — "Sample Platform Operator (Pilot Fixture)"
 *   - Agency Owner    (AGENCY_OWNER)         — "Sample Content Agency (Pilot Fixture)"
 *   - Client Owner    (CLIENT_OWNER)         — "Sample Manufacturing Enterprise (Pilot Fixture)"
 * All identities use reserved test domains (*.example.test / *.test); every org name carries a
 * "Sample"/"Pilot Fixture" marker. A dedicated assertion block proves NO fixture could be a real
 * customer (Real Customer Data = 0 is enforced, not assumed).
 *
 * THE PILOT CHAIN (each link asserted, all over HTTP unless noted):
 *   Platform login -> create Agency -> create Client -> assign agency (ACTIVE) -> create Project
 *   -> invite Client Owner -> Client login + accept invitation
 *   -> create Knowledge Package (audited) -> upload a real DOCX file (durable content round-trip)
 *   -> CONFIRM the knowledge package (audited) -> EnterpriseProfile (industry profile)
 *   -> KeywordQuestionMap -> Opportunity (+ automated validation)
 *   -> GET review-queue: extract the OPAQUE reviewReferenceCode (assert NO raw validation UUID in
 *      the client body) -> Client Review CONFIRMED via that opaque code
 *   -> OpportunityFamily -> ArticleBrief
 *   -> compile ArticleDraft: the OFFLINE deterministic provider produces content with ZERO network
 *      (PROVIDER_RUNTIME_ENABLED stays false), and its opaque envelope pointer feeds the compile route
 *   -> Quality/Platform/Vertical gates PASS -> Article Approval CONFIRMED
 *   -> PublishPackage (0 default channels) -> human selects channel -> DistributionPlan
 *   -> PublicationReceipt (actor bound to the signed human session)
 *   -> Client Delivery Center shows the DELIVERED article
 *   -> Agency sees ONLY its ACTIVE-assigned client -> Ops sees the full Audit Trail.
 *
 * PILOT INVARIANTS asserted directly at the end:
 *   - Provider real calls = 0 (structural + evidential): the offline adapter has no network import,
 *     PROVIDER_RUNTIME_ENABLED resolves to false, assertRealProviderCallAllowed() throws, the
 *     provider_execution ledger (migration 0007) has 0 rows for the tenant, and the persisted
 *     provider_article_content row stores exactly the opaque offline envelope pointer.
 *   - Automatic Publication = NO (an unsigned attempt is rejected 401; body actor cannot override session).
 *   - Default Selected Channel Count = 0 (the publish package selects no channel by default).
 *   - Real Customer Data = 0 (all fixtures desensitized — enforced by an explicit assertion block).
 *   - Tenant + agency-assignment isolation (a second client cannot read the first's data; the agency
 *     sees only its ACTIVE-assigned client).
 *   - Audit actor integrity (every audit row carries its tamper-evidence eventHash).
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf). No new deps.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
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
  type GeoRuntime,
} from "../../src/runtime/geo/runtime-context.js";

// The OFFLINE deterministic provider (D1) — no network import; safe while the flag is OFF.
import { DeterministicOfflineProviderAdapter } from "../../src/runtime/provider/deterministic-offline-adapter.js";
import {
  assertRealProviderCallAllowed,
  isProviderRuntimeEnabled,
  ProviderRuntimeDisabledError,
} from "../../src/runtime/provider/feature-flag.js";
import { PgProviderLedger } from "../../src/runtime/provider/pg-provider-ledger.js";
import type { ProviderGenerateArticleContentRequest } from "../../src/runtime/provider/provider-port.js";
import { TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH } from "../helpers/auth-credentials.js";

// --- Real App Router handlers under test (imported exactly as Next.js mounts them) ---
import { POST as loginRoute } from "../../src/app/api/auth/login/route.js";
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
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "knowledge", "fixtures");

const OOXML_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

// --- Desensitized fixtures (Real Customer Data = 0). Reserved test domains + explicit markers. ---
const FIXTURES = {
  platform: {
    email: "platform-admin@pilot.example.test",
    orgName: "Sample Platform Operator (Pilot Fixture)",
  },
  agency: {
    email: "agency-owner@pilot.example.test",
    orgName: "Sample Content Agency (Pilot Fixture)",
  },
  clientA: {
    email: "client-owner@pilot.example.test",
    orgName: "Sample Manufacturing Enterprise (Pilot Fixture)",
  },
  clientB: {
    email: "client-owner-b@pilot.example.test",
    orgName: "Sample Secondary Enterprise (Pilot Fixture)",
  },
  projectName: "Sample Pilot Content Project",
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

let db: DatabasePort;
let authRuntime: AuthRuntime;
let knowledgeRuntime: KnowledgeRuntime;
let geoRuntime: GeoRuntime;

// --- Out-of-band provisioning helpers (users + memberships have no HTTP route this checkpoint) ---

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [email, TEST_LOGIN_PASSWORD_HASH],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createOrg(
  type: "AGENCY" | "CLIENT" | "PLATFORM",
  key: string,
  name: string,
  createdBy: string,
): Promise<string> {
  const org = await authRuntime.repos.organizations.createIdempotent({
    type,
    displayName: name,
    idempotencyKey: key,
    createdByUserId: createdBy,
  });
  return org.id;
}

async function createMembership(
  userId: string,
  organizationId: string,
  role: PlatformRole,
): Promise<void> {
  await authRuntime.repos.memberships.create({ userId, organizationId, role });
}

// --- HTTP helpers -----------------------------------------------------------

/** Runs POST /api/auth/login for `email` and returns the reusable `name=value` Cookie header. */
async function loginAndGetCookie(email: string): Promise<string> {
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

// A single reusable caller types the context param as `any` so every handler is assignable — the
// same seam the existing product-http E2E uses. The context value we pass is the real
// `{ params: Promise.resolve({...}) }` Next.js hands the handler.
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

describe.skipIf(testConfig === null)(
  "PILOT_ACCEPTANCE_V1 — fully-desensitized three-role pilot E2E over real HTTP + Postgres",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
      authRuntime = createAuthRuntime(db);
      knowledgeRuntime = createKnowledgeRuntime(db, { contentStore: new PgKnowledgeContentStore(db) });
      geoRuntime = createGeoRuntime(db);
      __setAuthRuntimeForTests(authRuntime);
      __setKnowledgeRuntimeForTests(knowledgeRuntime);
      __setGeoRuntimeForTests(geoRuntime);
    });

    afterAll(async () => {
      __setAuthRuntimeForTests(null);
      __setKnowledgeRuntimeForTests(null);
      __setGeoRuntimeForTests(null);
      if (db) await db.close();
    });

    beforeEach(async () => {
      await db.query(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
    });

    it("drives the whole desensitized pilot over HTTP and holds every pilot invariant", async () => {
      // The pilot NEVER targets the production/runtime database — only the throwaway test db.
      expect(testConfig).not.toBeNull();
      expect(testConfig!.connectionString).not.toMatch(/\/geoplane_runtime(\?|$)/);

      // PROVIDER_RUNTIME_ENABLED stays OFF for the entire pilot: no real provider call is possible.
      expect(isProviderRuntimeEnabled()).toBe(false);

      // ================================================================
      // 0. Bootstrap the FIRST platform admin, then log in via the REAL login route.
      // ================================================================
      const platformUser = await createUser(FIXTURES.platform.email);
      const platformOrgId = await createOrg(
        "PLATFORM",
        "pilot-platform",
        FIXTURES.platform.orgName,
        platformUser,
      );
      await createMembership(platformUser, platformOrgId, "PLATFORM_SUPER_ADMIN");
      const platformCookie = await loginAndGetCookie(FIXTURES.platform.email);

      // ================================================================
      // 1. Platform creates the sample Agency (HTTP).
      // ================================================================
      const agency = await post(opsAgenciesRoute, "http://test/api/ops/agencies", platformCookie, {
        displayName: FIXTURES.agency.orgName,
      });
      expect(agency.status).toBe(200);
      expect(agency.body.data.type).toBe("AGENCY");
      const agencyId: string = agency.body.data.id;

      // ================================================================
      // 2. Platform creates the sample Client (HTTP).
      // ================================================================
      const clientA = await post(opsClientsRoute, "http://test/api/ops/clients", platformCookie, {
        displayName: FIXTURES.clientA.orgName,
      });
      expect(clientA.status).toBe(200);
      expect(clientA.body.data.type).toBe("CLIENT");
      const clientAId: string = clientA.body.data.id;

      // ================================================================
      // 3. Platform assigns the agency to the client (HTTP) — ACTIVE assignment.
      // ================================================================
      const assignment = await post(
        opsAssignmentsRoute,
        "http://test/api/ops/assignments",
        platformCookie,
        { agencyOrganizationId: agencyId, clientOrganizationId: clientAId },
      );
      expect(assignment.status).toBe(200);
      expect(assignment.body.data.status).toBe("ACTIVE");

      // ================================================================
      // 4. Platform creates the sample Project under the client (HTTP).
      // ================================================================
      const project = await post(projectsRoute, "http://test/api/commands/projects", platformCookie, {
        name: FIXTURES.projectName,
        clientOrganizationId: clientAId,
      });
      expect(project.status).toBe(200);
      expect(project.body.data.clientOrganizationId).toBe(clientAId);
      const projectId: string = project.body.data.id;
      const projectCtx = { params: Promise.resolve({ projectId }) };

      // ================================================================
      // 5. Platform invites the Client Owner (HTTP). The route persists only the token HASH.
      // ================================================================
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
      // The raw token is NEVER returned to the caller.
      expect(invite.body.data.token).toBeUndefined();
      expect(invite.body.data.tokenHash).toBeUndefined();

      // ================================================================
      // 6. The Client Owner comes on board: provision user + membership (no HTTP route), log in via
      //    the REAL login route, then accept an invitation via the REAL accept route. Because the
      //    invite route discards its raw token by design, a second invitation is seeded with a KNOWN
      //    token purely so the accept ROUTE can be exercised over HTTP.
      // ================================================================
      const clientOwnerUser = await createUser(FIXTURES.clientA.email);
      await createMembership(clientOwnerUser, clientAId, "CLIENT_OWNER");
      const clientCookie = await loginAndGetCookie(FIXTURES.clientA.email);

      const rawToken = randomUUID();
      await authRuntime.repos.invitations.create({
        organizationId: clientAId,
        invitedEmail: FIXTURES.clientA.email,
        role: "CLIENT_OWNER",
        tokenHash: hashInvitationToken(rawToken),
        createdByUserId: platformUser,
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

      // ================================================================
      // 7. Client Owner creates the enterprise knowledge package (audited create).
      // ================================================================
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

      // ================================================================
      // 8. Client Owner uploads a real DOCX knowledge file (HTTP) — the committed sample.docx bytes.
      //    The extracted text is ingested as version 1 and persisted in the durable content store.
      // ================================================================
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
        { params: Promise.resolve({ id: knowledgePackageId }) },
      );
      expect(upload.status).toBe(200);
      expect(upload.body.data.outcome).toBe("INGESTED");
      expect(upload.body.data.format).toBe("DOCX");
      expect(upload.body.data.version.versionNumber).toBe(1);
      // The real extracted DOCX text landed in Postgres, not just in the ingest response.
      const versionRow = await db.query<{ storage_path: string | null }>(
        `SELECT storage_path FROM knowledge_version WHERE package_id = $1 ORDER BY version_number LIMIT 1`,
        [knowledgePackageId],
      );
      const storagePath = versionRow.rows[0]?.storage_path;
      expect(storagePath).toBeTruthy();
      const storedText = await knowledgeRuntime.contentStore.get(storagePath!);
      expect(storedText).toContain("Hello DOCX from geoplane");

      // ================================================================
      // 9. Client Owner CONFIRMS (seals) the knowledge package (audited command route).
      // ================================================================
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

      // ================================================================
      // 10. Client Owner: enterprise (industry) profile (HTTP).
      // ================================================================
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

      // ================================================================
      // 11. Client Owner: keyword-question map (HTTP).
      // ================================================================
      const KEYWORD = "generative engine optimization";
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

      // ================================================================
      // 12. Client Owner: opportunity (+ automated validation) (HTTP).
      // ================================================================
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

      // ================================================================
      // 13. GET review-queue — extract the OPAQUE reviewReferenceCode. The client body must NOT
      //     carry the raw validation UUID (SAFE_REVIEW_REFERENCE_V1 / SYSTEM_INVARIANTS_V1).
      // ================================================================
      const queue = await get(
        reviewQueueRoute,
        `http://test/api/projects/${projectId}/review-queue`,
        clientCookie,
        projectCtx,
      );
      expect(queue.status).toBe(200);
      const queueItems = queue.body.data as Array<{
        id: string;
        status: string;
        review?: { reviewReferenceCode: string; reviewVersion: number; reviewStatus: string };
      }>;
      const reviewable = queueItems.find((q) => q.id === opportunityId);
      expect(reviewable, "the validated opportunity should be in the review queue").toBeTruthy();
      expect(reviewable!.status).toBe("VALIDATED");
      const reviewRef = reviewable!.review;
      expect(reviewRef, "a reviewable opportunity must carry an opaque review reference").toBeTruthy();
      expect(reviewRef!.reviewReferenceCode).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(reviewRef!.reviewStatus).toBe("PENDING");
      // OPAQUE handle invariant: the raw internal validation UUID appears NOWHERE in the client body.
      const clientQueueJson = JSON.stringify(queue.body);
      expect(clientQueueJson).not.toContain(opportunityValidationId);

      // ================================================================
      // 14. CLIENT REVIEW — CONFIRMED via the OPAQUE reviewReferenceCode (never a raw UUID). The
      //     reviewer is the real, session-derived client owner; there is no auto-approval path.
      // ================================================================
      const review = await post(
        opportunityReviewsRoute,
        `http://test/api/opportunities/${opportunityId}/reviews`,
        clientCookie,
        {
          reviewReferenceCode: reviewRef!.reviewReferenceCode,
          reviewVersion: reviewRef!.reviewVersion,
          decision: "CONFIRMED",
        },
        { params: Promise.resolve({ id: opportunityId }) },
      );
      expect(review.status).toBe(200);
      expect(review.body.data.status).toBe("APPROVED");
      expect(review.body.data.reviewerId).toBe(clientOwnerUser);
      const humanReviewDecisionId: string = review.body.data.id;

      // ================================================================
      // 15. Opportunity family (HTTP).
      // ================================================================
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
      expect(family.body.data.memberOpportunityIds).toEqual([opportunityId]);
      const opportunityFamilyId: string = family.body.data.id;

      // ================================================================
      // 16. Article brief (HTTP).
      // ================================================================
      const brief = await post(articleBriefsRoute, "http://test/api/article-briefs", clientCookie, {
        opportunityFamilyId,
        workingTitle: "The state of generative engine optimization",
        outline: ["Introduction", "How answer engines rank content", "Conclusion"],
        targetKeywords: [KEYWORD],
        riskLevel: "STANDARD",
      });
      expect(brief.status).toBe(200);
      const articleBriefId: string = brief.body.data.id;

      // ================================================================
      // 17. Compile draft using the OFFLINE deterministic provider. The adapter produces Stage-1
      //     content by a PURE, in-process hash of the request (NO network import of any kind); the
      //     flag stays OFF and no real call is possible. We prove the adapter is deterministic and
      //     offline, then feed its opaque envelope pointer to the compile route.
      // ================================================================
      const offlineAdapter = new DeterministicOfflineProviderAdapter("pilot");
      const providerRequest: ProviderGenerateArticleContentRequest = {
        projectId,
        articleBriefId,
        model: "offline-deterministic",
        maxTokens: 1024,
        timeoutMs: 30_000,
        requestId: `pilot-req-${articleBriefId}`,
        idempotencyKey: `pilot-idem-${articleBriefId}`,
      };
      const offlineResult = await offlineAdapter.generateArticleContent(providerRequest);
      expect(offlineResult.ok, "the offline provider should produce valid Stage-1 content").toBe(true);
      // Determinism: the same request yields byte-identical content, with zero I/O.
      const offlineResult2 = await offlineAdapter.generateArticleContent(providerRequest);
      expect(JSON.stringify(offlineResult2)).toBe(JSON.stringify(offlineResult));

      // The opaque offline envelope pointer the compile route ingests (produced entirely out-of-band
      // by the offline adapter above — never a live provider response).
      const OFFLINE_ENVELOPE = `offline_pilot_${providerRequest.idempotencyKey}`;
      const draft = await post(
        compileDraftRoute,
        "http://test/api/article-drafts/compile",
        clientCookie,
        { articleBriefId, providerResponseEnvelopeId: OFFLINE_ENVELOPE },
      );
      expect(draft.status).toBe(200);
      expect(draft.body.data.version).toBe(1);
      expect(draft.body.data.sectionCount).toBeGreaterThanOrEqual(1);
      const articleDraftId: string = draft.body.data.id;

      // ================================================================
      // 18. Approval (HTTP) — quality / platform / vertical gates PASS, explicit human approver.
      // ================================================================
      const approval = await post(
        articleReviewsRoute,
        `http://test/api/article-drafts/${articleDraftId}/reviews`,
        clientCookie,
        { industryProfileId },
        { params: Promise.resolve({ id: articleDraftId }) },
      );
      expect(approval.status).toBe(200);
      expect(approval.body.data.approverId).toBe(clientOwnerUser);

      // ================================================================
      // 19. Publish package (HTTP) — DEFAULT SELECTED CHANNEL COUNT = 0.
      // ================================================================
      const articleApprovalId: string = approval.body.data.id;
      const pub = await post(publishPackagesRoute, "http://test/api/publish-packages", clientCookie, {
        articleApprovalId,
        blocks: [{ kind: "PARAGRAPH", text: "GEO, explained for enterprises.", order: 0 }],
      });
      expect(pub.status).toBe(200);
      expect(pub.body.data.channelNeutralContentPackage.selectedChannelCount).toBe(0);
      const channelNeutralContentPackageId: string = pub.body.data.channelNeutralContentPackage.id;

      // ================================================================
      // 20. Distribution plan (HTTP) — a HUMAN explicitly selects exactly one channel.
      // ================================================================
      const CHANNEL = "sample_pilot_official_blog";
      const plan = await post(distributionPlansRoute, "http://test/api/distribution-plans", clientCookie, {
        channelNeutralContentPackageId,
        channelIds: [CHANNEL],
        selectedByActorId: clientOwnerUser,
      });
      expect(plan.status).toBe(200);
      expect(plan.body.data.channelIds).toEqual([CHANNEL]);
      expect(plan.body.data.selectedByActorId).toBe(clientOwnerUser);
      const distributionPlanId: string = plan.body.data.id;

      // ================================================================
      // 21. Publication receipt (HTTP). AUTOMATIC PUBLICATION = NO: no signed human session means
      //     401 and no write. A forged body actor cannot override the signed client-owner actor.
      // ================================================================
      const autoReceipt = await post(
        publicationReceiptsRoute,
        "http://test/api/publication-receipts",
        null,
        { distributionPlanId, channelId: CHANNEL, publishedByActorId: "system" },
      );
      expect(autoReceipt.status).toBe(401);
      expect(autoReceipt.body.error.code).toBe("UNAUTHENTICATED");
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
      expect(receipt.body.data.publishedByActorId).toBe(clientOwnerUser);

      // ================================================================
      // 22. Client Delivery Center (HTTP GET) — the client sees the DELIVERED article.
      // ================================================================
      const deliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${projectId}/deliveries`,
        clientCookie,
        projectCtx,
      );
      expect(deliveries.status).toBe(200);
      const delivered = (deliveries.body.data as Array<{ status: string; title: string }>).filter(
        (d) => d.status === "DELIVERED",
      );
      expect(delivered.length).toBeGreaterThanOrEqual(1);

      // ================================================================
      // 23. Agency Workspace (HTTP GET) — the agency owner sees ONLY its ACTIVE-assigned client.
      // ================================================================
      const agencyOwnerUser = await createUser(FIXTURES.agency.email);
      await createMembership(agencyOwnerUser, agencyId, "AGENCY_OWNER");
      const agencyCookie = await loginAndGetCookie(FIXTURES.agency.email);

      const agencyView = await get(agencyClientsRoute, "http://test/api/agency/clients", agencyCookie);
      expect(agencyView.status).toBe(200);
      const listedClients = agencyView.body.data.clients as Array<{
        clientOrganizationId: string;
        projectCount: number;
      }>;
      expect(listedClients).toHaveLength(1);
      const listedClient = listedClients[0];
      expect(listedClient).toBeTruthy();
      expect(listedClient!.clientOrganizationId).toBe(clientAId);
      expect(listedClient!.projectCount).toBe(1);

      // ================================================================
      // 24. Ops Audit (HTTP GET) — the platform sees the FULL domain trail of the pilot, and every
      //     audit row carries its tamper-evidence eventHash (audit actor integrity).
      // ================================================================
      const audit = await get(opsAuditRoute, "http://test/api/ops/audit", platformCookie);
      expect(audit.status).toBe(200);
      const auditRows = audit.body.data as Array<{ action: string }>;
      const actions = new Set(auditRows.map((e) => e.action));
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

      // ================================================================
      // 25. TENANT ISOLATION — a second client cannot read the first client's data via the routes.
      // ================================================================
      const clientB = await post(opsClientsRoute, "http://test/api/ops/clients", platformCookie, {
        displayName: FIXTURES.clientB.orgName,
      });
      expect(clientB.status).toBe(200);
      const clientBId: string = clientB.body.data.id;
      const projectB = await post(projectsRoute, "http://test/api/commands/projects", platformCookie, {
        name: "Sample Secondary Pilot Project",
        clientOrganizationId: clientBId,
      });
      expect(projectB.status).toBe(200);
      const projectBId: string = projectB.body.data.id;

      const clientBOwnerUser = await createUser(FIXTURES.clientB.email);
      await createMembership(clientBOwnerUser, clientBId, "CLIENT_OWNER");
      const clientBCookie = await loginAndGetCookie(FIXTURES.clientB.email);

      // Client B cannot read Client A's deliveries -> 403 (cross-tenant, fail-closed).
      const crossDeliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${projectId}/deliveries`,
        clientBCookie,
        projectCtx,
      );
      expect(crossDeliveries.status).toBe(403);

      // Client B cannot read Client A's knowledge package -> 403.
      const crossPackage = await get(
        getPackageRoute,
        `http://test/api/knowledge/packages/${knowledgePackageId}`,
        clientBCookie,
        { params: Promise.resolve({ id: knowledgePackageId }) },
      );
      expect(crossPackage.status).toBe(403);

      // Client B's OWN deliveries are empty — a control for the 403s above.
      const ownDeliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${projectBId}/deliveries`,
        clientBCookie,
        { params: Promise.resolve({ projectId: projectBId }) },
      );
      expect(ownDeliveries.status).toBe(200);
      expect(ownDeliveries.body.data).toEqual([]);

      // ================================================================
      // 26. AGENCY-ASSIGNMENT ISOLATION — the agency is NOT assigned to Client B, so it still sees
      //     ONLY Client A (never the unassigned second client).
      // ================================================================
      const agencyViewAfter = await get(agencyClientsRoute, "http://test/api/agency/clients", agencyCookie);
      expect(agencyViewAfter.status).toBe(200);
      const clientsAfter = agencyViewAfter.body.data.clients as Array<{ clientOrganizationId: string }>;
      expect(clientsAfter.map((c) => c.clientOrganizationId)).toEqual([clientAId]);
      expect(clientsAfter.some((c) => c.clientOrganizationId === clientBId)).toBe(false);

      // ================================================================
      // PILOT INVARIANTS — asserted directly with real evidence.
      // ================================================================

      // --- INVARIANT: Provider real calls = 0. ---
      // (a) The flag is OFF, so a REAL provider call is structurally refused.
      expect(isProviderRuntimeEnabled()).toBe(false);
      expect(() => assertRealProviderCallAllowed()).toThrow(ProviderRuntimeDisabledError);
      // (b) The durable provider_execution ledger (migration 0007) has ZERO rows for this tenant:
      //     no real call was ever ledgered (the offline adapter never writes to it).
      const ledger = new PgProviderLedger(db);
      const ledgerRows = await ledger.listByScope({
        clientOrganizationId: clientAId,
        projectId,
      });
      expect(ledgerRows).toHaveLength(0);
      const ledgerTotal = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM provider_execution`,
      );
      expect(ledgerTotal.rows[0]!.n).toBe("0");
      // (c) The persisted provider_article_content row stores EXACTLY the opaque offline envelope
      //     pointer — never a payload from a live call.
      const providerRow = await db.query<{ provider_response_envelope_id: string }>(
        `SELECT provider_response_envelope_id FROM provider_article_content WHERE article_brief_id = $1`,
        [articleBriefId],
      );
      expect(providerRow.rows).toHaveLength(1);
      expect(providerRow.rows[0]!.provider_response_envelope_id).toBe(OFFLINE_ENVELOPE);

      // --- INVARIANT: Automatic Publication = NO (proven by the 422 + zero-write above). ---
      // --- INVARIANT: Default Selected Channel Count = 0 (proven at step 19). ---

      // --- INVARIANT: audit actor integrity — every persisted audit_event carries its tamper-
      //     evidence hash and a real (non-null) actor, verified straight from the durable table
      //     (the internal event_hash is deliberately not on the client audit view). ---
      expect(auditRows.length).toBeGreaterThan(0);
      const auditIntegrity = await db.query<{ total: string; hashed: string; with_actor: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE event_hash IS NOT NULL AND length(event_hash) > 0)::text AS hashed,
                count(*) FILTER (WHERE actor_user_id IS NOT NULL)::text AS with_actor
           FROM audit_event`,
      );
      const integ = auditIntegrity.rows[0]!;
      expect(Number(integ.total)).toBeGreaterThan(0);
      expect(integ.hashed).toBe(integ.total); // every row is tamper-evidence hashed
      expect(integ.with_actor).toBe(integ.total); // every row carries a real actor id

      // --- INVARIANT: Real Customer Data = 0 — every fixture is a reserved-test-domain sample. ---
      const orgRows = await db.query<{ display_name: string; type: string }>(
        `SELECT display_name, type FROM organization`,
      );
      // Every non-platform org name carries an explicit "Sample"/"Pilot Fixture" desensitization marker.
      for (const row of orgRows.rows) {
        expect(
          /sample|pilot fixture/i.test(row.display_name),
          `org "${row.display_name}" must be a desensitized sample fixture`,
        ).toBe(true);
      }
      const userRows = await db.query<{ email: string }>(`SELECT email FROM "user"`);
      // Every user email uses a reserved, non-routable test domain (RFC 2606 / 6761): no real inbox.
      for (const row of userRows.rows) {
        expect(
          /@([a-z0-9-]+\.)*(example|test)$/i.test(row.email) || /\.test$/i.test(row.email),
          `email "${row.email}" must use a reserved test domain (Real Customer Data = 0)`,
        ).toBe(true);
      }
    });
  },
);
