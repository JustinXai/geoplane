/**
 * PRODUCT_HTTP_E2E_PG — the ENTIRE section-14 product loop driven end-to-end through the REAL
 * Next.js App Router route handlers against a real PostgreSQL database (GEO_TEST_DATABASE_URL,
 * throwaway db geoplane_pc_e2e). This is the product-runtime acceptance test: every business step
 * after the platform-admin bootstrap goes over HTTP — each handler is invoked exactly as Next.js
 * invokes it, with `new Request(url, { method, headers: { cookie, 'content-type' }, body })` and,
 * for `[param]` routes, a `{ params: Promise.resolve({...}) }` context. The Set-Cookie minted by
 * POST /api/auth/login is threaded (as the reusable `name=value` Cookie header) into every
 * subsequent request, exactly like a browser session.
 *
 * The loop (each link asserted):
 *   bootstrap platform admin (repos) -> POST /api/auth/login (platform)
 *   -> POST /api/ops/agencies -> POST /api/ops/clients -> POST /api/ops/assignments
 *   -> POST /api/commands/projects -> POST /api/projects/[id]/invitations
 *   -> (client owner) login + POST /api/invitations/[token]/accept
 *   -> POST /api/commands/projects/[id]/knowledge-packages (audited create)
 *   -> POST /api/knowledge/packages/[id]/files (upload the real sample.docx bytes; content read back)
 *   -> POST /api/commands/projects/[id]/enterprise-profile -> keyword-maps -> opportunities
 *   -> POST /api/opportunities/[id]/reviews (CONFIRMED) -> POST /api/opportunity-families
 *   -> POST /api/article-briefs -> POST /api/article-drafts/compile
 *   -> POST /api/article-drafts/[id]/reviews (approval; 3 gates PASS)
 *   -> POST /api/publish-packages (0 default channels) -> POST /api/distribution-plans
 *   -> POST /api/publication-receipts (actor bound to the signed human session)
 *   -> GET /api/projects/[id]/deliveries (client sees the delivery)
 *   -> GET /api/agency/clients (agency sees only its ACTIVE-assigned client)
 *   -> GET /api/ops/audit (platform sees the full trail).
 *
 * Final invariants asserted directly: Provider Calls = 0 (content entered ONLY as an opaque offline
 * envelope pointer — no provider/network port exists in the graph), Automatic Publication = NO (a
 * unsigned publication is rejected 401 and body actor is ignored), Default Selected Channel Count = 0, Production DB writes
 * = 0 (the connection string is the throwaway test db, never geoplane_runtime), and tenant isolation
 * (a second client cannot read the first client's data through the routes -> 403 / empty).
 *
 * Bootstrapping note (SYSTEM_INVARIANTS_V1): this checkpoint ships no self-serve signup and no
 * HTTP route that provisions a `user` row or a `membership` (an invitation accept deliberately does
 * NOT create a membership, and login requires a pre-existing ACTIVE membership). So the ONLY
 * out-of-band steps are: seeding `user` rows and their `membership` rows (the platform admin, the
 * client owners, the agency owner) and — because POST /api/projects/[id]/invitations mints a random
 * token and discards the raw value by design (out-of-band delivery is a later checkpoint) — seeding
 * one invitation with a known token so the real accept ROUTE can be exercised over HTTP. Every
 * business operation itself is driven through the real route handlers.
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
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
import { POST as uploadFileRoute } from "../../src/app/api/knowledge/packages/[id]/files/route.js";
import { GET as getPackageRoute } from "../../src/app/api/knowledge/packages/[id]/route.js";
import { POST as enterpriseProfileRoute } from "../../src/app/api/commands/projects/[projectId]/enterprise-profile/route.js";
import { POST as keywordMapsRoute } from "../../src/app/api/commands/projects/[projectId]/keyword-maps/route.js";
import { POST as opportunitiesRoute } from "../../src/app/api/commands/projects/[projectId]/opportunities/route.js";
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

/** Every table this scenario touches, child-before-parent for CASCADE-safe truncation. */
const ALL_TABLES = [
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
  const res = await db.query<{ id: string }>(`INSERT INTO "user" (email) VALUES ($1) RETURNING id`, [
    email,
  ]);
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

// Route handlers each declare their own `context` shape ({ params: Promise<{...}> } or none). A
// single reusable caller types the context param as `any` so every handler is assignable — the
// same seam the existing route tests use (they cast each handler `as never`). The context value we
// pass is the real `{ params: Promise.resolve({...}) }` Next.js hands the handler.
type Handler = (request: Request, context?: any) => Promise<Response>;

interface CallResult {
  readonly status: number;
  // The parsed ApiResponseV1 envelope. `any` keeps the long assertion chain readable; every field
  // accessed below is asserted, so a shape drift surfaces as a failing assertion.
  readonly body: any;
}

/** POST a JSON body through a handler and return `{ status, body }`. */
async function post(
  handler: Handler,
  url: string,
  cookie: string | null,
  body: unknown,
  context?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json", ...extraHeaders };
  if (cookie) headers["cookie"] = cookie;
  const res = await handler(
    new Request(url, { method: "POST", headers, body: JSON.stringify(body) }),
    context,
  );
  return { status: res.status, body: await res.json() };
}

/** GET through a handler and return `{ status, body }`. */
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
  "PRODUCT_HTTP_E2E_PG — full section-14 product loop through the real route handlers",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
      authRuntime = createAuthRuntime(db);
      // Persist uploaded content to Postgres (the durable content store) so the content read-back is
      // a real DB round-trip, not a process-local Map. All three lane runtimes share the ONE db.
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

    it("drives the entire loop over HTTP: 0 provider calls, no auto-publication, 0 default channels, tenant isolation holds", async () => {
      // --- Production DB writes = 0: the routes only ever touch the throwaway TEST database, never
      // the production/runtime one. The single hard rule is that geoplane_runtime is never targeted;
      // any isolated test db is fine. ---
      expect(testConfig).not.toBeNull();
      expect(testConfig!.connectionString).not.toMatch(/\/geoplane_runtime(\?|$)/);

      // ====================================================================
      // 0. Bootstrap the FIRST platform admin (user + PLATFORM org + membership), then log in via
      //    the REAL login route. Everything after this is driven over HTTP.
      // ====================================================================
      const platformUser = await createUser("platform-admin@acme.test");
      const platformOrgId = await createOrg("PLATFORM", "e2e-platform", "Acme Platform Operator", platformUser);
      await createMembership(platformUser, platformOrgId, "PLATFORM_SUPER_ADMIN");
      const platformCookie = await loginAndGetCookie("platform-admin@acme.test");

      // ====================================================================
      // 1. Platform creates an Agency (HTTP).
      // ====================================================================
      const agency = await post(opsAgenciesRoute, "http://test/api/ops/agencies", platformCookie, {
        displayName: "Acme Agency",
      });
      expect(agency.status).toBe(200);
      expect(agency.body.data.type).toBe("AGENCY");
      const agencyId: string = agency.body.data.id;

      // ====================================================================
      // 2. Platform creates the (first) Client (HTTP).
      // ====================================================================
      const clientA = await post(opsClientsRoute, "http://test/api/ops/clients", platformCookie, {
        displayName: "Client A Enterprise",
      });
      expect(clientA.status).toBe(200);
      expect(clientA.body.data.type).toBe("CLIENT");
      const clientAId: string = clientA.body.data.id;

      // ====================================================================
      // 3. Platform assigns the agency to Client A (HTTP) — ACTIVE assignment.
      // ====================================================================
      const assignment = await post(
        opsAssignmentsRoute,
        "http://test/api/ops/assignments",
        platformCookie,
        { agencyOrganizationId: agencyId, clientOrganizationId: clientAId },
      );
      expect(assignment.status).toBe(200);
      expect(assignment.body.data.status).toBe("ACTIVE");

      // ====================================================================
      // 4. Platform creates a Project under Client A (HTTP).
      // ====================================================================
      const project = await post(projectsRoute, "http://test/api/commands/projects", platformCookie, {
        name: "Client A Launch Content",
        clientOrganizationId: clientAId,
      });
      expect(project.status).toBe(200);
      expect(project.body.data.clientOrganizationId).toBe(clientAId);
      const projectId: string = project.body.data.id;
      const projectCtx = { params: Promise.resolve({ projectId }) };

      // ====================================================================
      // 5. Platform invites a Client Owner to the project (HTTP). The route persists only the token
      //    HASH and never returns the raw token (see the module header).
      // ====================================================================
      const invite = await post(
        invitationsRoute,
        `http://test/api/projects/${projectId}/invitations`,
        platformCookie,
        { invitedEmail: "owner@client-a.test" },
        projectCtx,
      );
      expect(invite.status).toBe(200);
      expect(invite.body.data.status).toBe("PENDING");
      expect(invite.body.data.role).toBe("CLIENT_OWNER");
      expect(invite.body.data.organizationId).toBe(clientAId);
      expect(invite.body.data.token).toBeUndefined();
      expect(invite.body.data.tokenHash).toBeUndefined();
      // The persisted invitation carries only a 64-hex sha256 hash — never a raw token.
      const invRow = await db.query<{ token_hash: string }>(
        `SELECT token_hash FROM invitation WHERE id = $1`,
        [invite.body.data.id],
      );
      expect(invRow.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);

      // ====================================================================
      // 6. The Client Owner comes on board: provision the user + membership (no HTTP route exists
      //    for either), log in via the REAL login route, then accept an invitation via the REAL
      //    accept route. Because the invite route above discards its raw token by design, a second
      //    invitation is seeded with a KNOWN token purely so the accept ROUTE can be exercised.
      // ====================================================================
      const clientOwnerUser = await createUser("owner@client-a.test");
      await createMembership(clientOwnerUser, clientAId, "CLIENT_OWNER");
      const clientCookie = await loginAndGetCookie("owner@client-a.test");

      const rawToken = randomUUID();
      await authRuntime.repos.invitations.create({
        organizationId: clientAId,
        invitedEmail: "owner@client-a.test",
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

      // ====================================================================
      // 7. Client Owner creates the enterprise knowledge package via the AUDITED command route
      //    (emits knowledge_package.created).
      // ====================================================================
      const kp = await post(
        knowledgePackagesRoute,
        `http://test/api/commands/projects/${projectId}/knowledge-packages`,
        clientCookie,
        { title: "Client A Enterprise Knowledge" },
        projectCtx,
      );
      expect(kp.status).toBe(200);
      expect(kp.body.data.status).toBe("DRAFT");
      const knowledgePackageId: string = kp.body.data.id;

      // ====================================================================
      // 8. Client Owner uploads a real DOCX knowledge file (HTTP) — the committed sample.docx bytes.
      //    The extracted text is ingested as version 1 and persisted in the durable content store.
      // ====================================================================
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
      // Read the uploaded CONTENT back out of the durable store by its persisted storage path — the
      // real extracted DOCX text landed in Postgres, not just in the ingest response.
      const versionRow = await db.query<{ storage_path: string | null }>(
        `SELECT storage_path FROM knowledge_version WHERE package_id = $1 ORDER BY version_number LIMIT 1`,
        [knowledgePackageId],
      );
      const storagePath = versionRow.rows[0]?.storage_path;
      expect(storagePath).toBeTruthy();
      const storedText = await knowledgeRuntime.contentStore.get(storagePath!);
      expect(storedText).toContain("Hello DOCX from geoplane");

      // ====================================================================
      // 9. Client Owner: enterprise (industry) profile (HTTP).
      // ====================================================================
      const profile = await post(
        enterpriseProfileRoute,
        `http://test/api/commands/projects/${projectId}/enterprise-profile`,
        clientCookie,
        {
          verticalSlug: "b2b-saas",
          verticalLabel: "B2B SaaS",
          validationGateLevel: "PLATFORM_WIDE_GATE",
          ruleSetVersion: 1,
        },
        projectCtx,
      );
      expect(profile.status).toBe(200);
      const industryProfileId: string = profile.body.data.id;

      // ====================================================================
      // 10. Client Owner: keyword-question map (HTTP).
      // ====================================================================
      const map = await post(
        keywordMapsRoute,
        `http://test/api/commands/projects/${projectId}/keyword-maps`,
        clientCookie,
        {
          knowledgePackageId,
          industryProfileId,
          entries: [
            {
              keyword: "generative engine optimization",
              questions: ["what is generative engine optimization?", "how does GEO work?"],
            },
          ],
        },
        projectCtx,
      );
      expect(map.status).toBe(200);
      expect(map.body.data.keywords).toEqual(["generative engine optimization"]);
      const keywordQuestionMapId: string = map.body.data.id;

      // ====================================================================
      // 11. Client Owner: opportunity (+ automated validation) (HTTP).
      // ====================================================================
      const opp = await post(
        opportunitiesRoute,
        `http://test/api/commands/projects/${projectId}/opportunities`,
        clientCookie,
        { keywordQuestionMapId, keyword: "generative engine optimization" },
        projectCtx,
      );
      expect(opp.status).toBe(200);
      expect(opp.body.data.validation.status).toBe("VALIDATED");
      const opportunityId: string = opp.body.data.opportunity.id;
      const opportunityValidationId: string = opp.body.data.validation.id;

      // ====================================================================
      // 12. CLIENT REVIEW — CONFIRMED (HTTP). The reviewer is the real, session-derived client owner;
      //     there is no auto-approval path.
      // ====================================================================
      const review = await post(
        opportunityReviewsRoute,
        `http://test/api/opportunities/${opportunityId}/reviews`,
        clientCookie,
        { opportunityValidationId, decision: "CONFIRMED" },
        { params: Promise.resolve({ id: opportunityId }) },
      );
      expect(review.status).toBe(200);
      expect(review.body.data.status).toBe("APPROVED");
      expect(review.body.data.reviewerId).toBe(clientOwnerUser);
      const humanReviewDecisionId: string = review.body.data.id;

      // ====================================================================
      // 13. Opportunity family (HTTP).
      // ====================================================================
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

      // ====================================================================
      // 14. Article brief (HTTP).
      // ====================================================================
      const brief = await post(articleBriefsRoute, "http://test/api/article-briefs", clientCookie, {
        opportunityFamilyId,
        workingTitle: "The state of generative engine optimization",
        outline: ["Introduction", "How answer engines rank content", "Conclusion"],
        targetKeywords: ["generative engine optimization"],
        riskLevel: "STANDARD",
      });
      expect(brief.status).toBe(200);
      const articleBriefId: string = brief.body.data.id;

      // ====================================================================
      // 15. Compile draft (HTTP). Content enters ONLY as an opaque offline envelope pointer — no
      //     provider/network call.
      // ====================================================================
      const OFFLINE_ENVELOPE = "offline_envelope_product_e2e_1";
      const draft = await post(
        compileDraftRoute,
        "http://test/api/article-drafts/compile",
        clientCookie,
        { articleBriefId, providerResponseEnvelopeId: OFFLINE_ENVELOPE },
      );
      expect(draft.status).toBe(200);
      expect(draft.body.data.version).toBe(1);
      expect(draft.body.data.sectionCount).toBe(3);
      const articleDraftId: string = draft.body.data.id;

      // ====================================================================
      // 16. Approval (HTTP) — quality / platform / vertical gates PASS, explicit human approver.
      // ====================================================================
      const approval = await post(
        articleReviewsRoute,
        `http://test/api/article-drafts/${articleDraftId}/reviews`,
        clientCookie,
        { industryProfileId },
        { params: Promise.resolve({ id: articleDraftId }) },
      );
      expect(approval.status).toBe(200);
      expect(approval.body.data.approverId).toBe(clientOwnerUser);
      const articleApprovalId: string = approval.body.data.id;

      // ====================================================================
      // 17. Publish package (HTTP) — DEFAULT SELECTED CHANNEL COUNT = 0.
      // ====================================================================
      const pub = await post(publishPackagesRoute, "http://test/api/publish-packages", clientCookie, {
        articleApprovalId,
        blocks: [{ kind: "PARAGRAPH", text: "GEO, explained for enterprises.", order: 0 }],
      });
      expect(pub.status).toBe(200);
      expect(pub.body.data.channelNeutralContentPackage.selectedChannelCount).toBe(0);
      const channelNeutralContentPackageId: string = pub.body.data.channelNeutralContentPackage.id;

      // ====================================================================
      // 18. Distribution plan (HTTP) — a human explicitly selects exactly one channel.
      // ====================================================================
      const CHANNEL = "client_a_official_blog";
      const plan = await post(distributionPlansRoute, "http://test/api/distribution-plans", clientCookie, {
        channelNeutralContentPackageId,
        channelIds: [CHANNEL],
        selectedByActorId: clientOwnerUser,
      });
      expect(plan.status).toBe(200);
      expect(plan.body.data.channelIds).toEqual([CHANNEL]);
      expect(plan.body.data.selectedByActorId).toBe(clientOwnerUser);
      const distributionPlanId: string = plan.body.data.id;

      // ====================================================================
      // 19. Publication receipt (HTTP). AUTOMATIC PUBLICATION = NO: no signed human session is
      //     rejected 401 and writes nothing; request-body actor cannot override the session actor.
      // ====================================================================
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

      // --- Provider Calls = 0 (evidence): content entered ONLY as the opaque offline envelope
      // pointer — the append-only provider_article_content row stores exactly that id, never a
      // payload from a live call, and there is no provider/network port anywhere in the graph. ---
      const providerRow = await db.query<{ provider_response_envelope_id: string }>(
        `SELECT provider_response_envelope_id FROM provider_article_content WHERE article_brief_id = $1`,
        [articleBriefId],
      );
      expect(providerRow.rows).toHaveLength(1);
      expect(providerRow.rows[0]!.provider_response_envelope_id).toBe(OFFLINE_ENVELOPE);

      // ====================================================================
      // 20. Client Delivery Center (HTTP GET) — the client sees the DELIVERED article.
      // ====================================================================
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

      // ====================================================================
      // 21. Agency Workspace (HTTP GET) — the agency owner sees ONLY its ACTIVE-assigned client.
      //     Provision the agency owner + membership (no HTTP route), log in, then read.
      // ====================================================================
      const agencyOwnerUser = await createUser("owner@acme-agency.test");
      await createMembership(agencyOwnerUser, agencyId, "AGENCY_OWNER");
      const agencyCookie = await loginAndGetCookie("owner@acme-agency.test");

      const agencyView = await get(agencyClientsRoute, "http://test/api/agency/clients", agencyCookie);
      expect(agencyView.status).toBe(200);
      const listedClients = agencyView.body.data.clients as Array<{
        clientOrganizationId: string;
        projectCount: number;
      }>;
      expect(listedClients).toHaveLength(1);
      expect(listedClients[0]!.clientOrganizationId).toBe(clientAId);
      expect(listedClients[0]!.projectCount).toBe(1);

      // ====================================================================
      // 22. Ops Audit (HTTP GET) — the platform sees the FULL domain trail of the loop.
      // ====================================================================
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

      // ====================================================================
      // 23. TENANT ISOLATION — a second client cannot read the first client's data via the routes.
      // ====================================================================
      const clientB = await post(opsClientsRoute, "http://test/api/ops/clients", platformCookie, {
        displayName: "Client B Enterprise",
      });
      expect(clientB.status).toBe(200);
      const clientBId: string = clientB.body.data.id;
      const projectB = await post(projectsRoute, "http://test/api/commands/projects", platformCookie, {
        name: "Client B Project",
        clientOrganizationId: clientBId,
      });
      expect(projectB.status).toBe(200);
      const projectBId: string = projectB.body.data.id;

      const clientBOwnerUser = await createUser("owner@client-b.test");
      await createMembership(clientBOwnerUser, clientBId, "CLIENT_OWNER");
      const clientBCookie = await loginAndGetCookie("owner@client-b.test");

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

      // Client B's OWN deliveries are empty (it created nothing) — a control for the 403s above.
      const ownDeliveries = await get(
        deliveriesRoute,
        `http://test/api/projects/${projectBId}/deliveries`,
        clientBCookie,
        { params: Promise.resolve({ projectId: projectBId }) },
      );
      expect(ownDeliveries.status).toBe(200);
      expect(ownDeliveries.body.data).toEqual([]);
    });
  },
);
