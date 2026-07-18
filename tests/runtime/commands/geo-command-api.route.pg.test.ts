/**
 * Real-Postgres route tests for BUSINESS_COMMAND_API_V1 batch 2 (Agent C) — the GEO business-chain
 * write commands + the knowledge audit-gap closure.
 *
 * Drives the whole chain end-to-end over GEO_TEST_DATABASE_URL by invoking the exported App Router
 * handlers with `new Request(...)`:
 *
 *   knowledge package -> industry (enterprise) profile -> keyword map -> opportunity (+ validation)
 *   -> human review CONFIRMED -> opportunity family -> article brief -> compile draft (offline,
 *   Provider Calls = 0) -> article approval (3 gates PASS) -> publish package (0 channels) ->
 *   distribution plan (human-selected channel) -> publication receipt (real human actor)
 *
 * and asserts persistence + the domain audit trail + every invariant this checkpoint must preserve:
 *   - unauthenticated -> 401;
 *   - cross-tenant -> 403 + a DENIED audit row;
 *   - human review is NEVER auto-approved (a decision requires an explicit reviewer);
 *   - article approval is NEVER auto-approved (an explicit approver + three PASSED gates);
 *   - the default selected-channel count of a publish package is 0;
 *   - a system/automatic publication actor is rejected;
 *   - a `knowledge_package.created` audit is emitted through the knowledge command wrapper;
 *   - the same Idempotency-Key yields exactly ONE entity.
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import type { PlatformRole } from "../../../src/contracts/tenancy/entities.js";
import {
  createAuthRuntime,
  __setAuthRuntimeForTests,
  type AuthRuntime,
} from "../../../src/runtime/auth/runtime-context.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { POST as knowledgePackagesRoute } from "../../../src/app/api/commands/projects/[projectId]/knowledge-packages/route.js";
import { POST as enterpriseProfileRoute } from "../../../src/app/api/commands/projects/[projectId]/enterprise-profile/route.js";
import { POST as keywordMapsRoute } from "../../../src/app/api/commands/projects/[projectId]/keyword-maps/route.js";
import { POST as opportunitiesRoute } from "../../../src/app/api/commands/projects/[projectId]/opportunities/route.js";
import { POST as opportunityReviewsRoute } from "../../../src/app/api/opportunities/[id]/reviews/route.js";
import { POST as opportunityFamiliesRoute } from "../../../src/app/api/opportunity-families/route.js";
import { POST as articleBriefsRoute } from "../../../src/app/api/article-briefs/route.js";
import { POST as compileDraftRoute } from "../../../src/app/api/article-drafts/compile/route.js";
import { POST as articleReviewsRoute } from "../../../src/app/api/article-drafts/[id]/reviews/route.js";
import { POST as publishPackagesRoute } from "../../../src/app/api/publish-packages/route.js";
import { POST as distributionPlansRoute } from "../../../src/app/api/distribution-plans/route.js";
import { POST as publicationReceiptsRoute } from "../../../src/app/api/publication-receipts/route.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

let db: DatabasePort;
let runtime: AuthRuntime;

// --- seed helpers -----------------------------------------------------------

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
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
  const org = await runtime.repos.organizations.createIdempotent({
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
  await runtime.repos.memberships.create({ userId, organizationId, role });
}

async function createProject(clientOrganizationId: string, name: string, createdBy: string): Promise<string> {
  const project = await runtime.repos.projects.create({
    clientOrganizationId,
    name,
    createdByUserId: createdBy,
  });
  return project.id;
}

async function loginAndGetCookie(email: string): Promise<string> {
  const res = await loginRoute(
    new Request("http://test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a cookie");
  return setCookie.split(";")[0]!;
}

interface Ctx<P> {
  readonly params: Promise<P>;
}

function req(
  url: string,
  cookie: string | null,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...extraHeaders };
  if (cookie) headers["cookie"] = cookie;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

/** POST a JSON body to a handler and parse `{ status, body }`. */
async function post(
  handler: (request: Request, context?: unknown) => Promise<Response>,
  url: string,
  cookie: string | null,
  body: unknown,
  context?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await handler(req(url, cookie, body, extraHeaders), context);
  return { status: res.status, body: await res.json() };
}

async function countRows(table: string, whereSql: string, params: unknown[]): Promise<number> {
  const res = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE ${whereSql}`,
    params as never,
  );
  return Number(res.rows[0]!.n);
}

async function auditCount(action: string): Promise<number> {
  const res = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_event WHERE action = $1`,
    [action],
  );
  return Number(res.rows[0]!.n);
}

const TABLES = [
  "audit_event",
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
  "knowledge_package",
  "session",
  "invitation",
  "agency_client_assignment",
  "membership",
  "project",
  "organization",
  '"user"',
].join(", ");

describe.skipIf(testConfig === null)(
  "BUSINESS_COMMAND_API_V1 batch 2 — GEO business-chain command routes over real Postgres",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
      runtime = createAuthRuntime(db);
      __setAuthRuntimeForTests(runtime);
    });

    afterAll(async () => {
      __setAuthRuntimeForTests(null);
      if (db) await db.close();
    });

    beforeEach(async () => {
      await db.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    });

    it("drives the full GEO chain via HTTP and persists + audits every step", async () => {
      const adminUser = await createUser("platform-chain@example.test");
      const platformOrg = await createOrg("PLATFORM", "pf-chain", "Platform Chain", adminUser);
      await createMembership(adminUser, platformOrg, "PLATFORM_SUPER_ADMIN");
      const cookie = await loginAndGetCookie("platform-chain@example.test");

      const clientOrg = await createOrg("CLIENT", "cl-chain", "Client Chain", adminUser);
      const projectId = await createProject(clientOrg, "Chain Project", adminUser);

      const base = `http://test/api/commands/projects/${projectId}`;
      const projectCtx: Ctx<{ projectId: string }> = { params: Promise.resolve({ projectId }) };

      // 1. Knowledge package (audit-gap closure — must emit knowledge_package.created).
      const kp = await post(knowledgePackagesRoute as never, `${base}/knowledge-packages`, cookie, { title: "Ops Knowledge" }, projectCtx);
      expect(kp.status).toBe(200);
      expect(kp.body.ok).toBe(true);
      expect(kp.body.data.status).toBe("DRAFT");
      const knowledgePackageId: string = kp.body.data.id;

      // 2. Enterprise (industry) profile.
      const profile = await post(enterpriseProfileRoute as never, `${base}/enterprise-profile`, cookie, {
        verticalSlug: "b2b-saas",
        verticalLabel: "B2B SaaS",
        validationGateLevel: "PLATFORM_WIDE_GATE",
        ruleSetVersion: 1,
      }, projectCtx);
      expect(profile.status).toBe(200);
      const industryProfileId: string = profile.body.data.id;

      // 3. Keyword-question map.
      const map = await post(keywordMapsRoute as never, `${base}/keyword-maps`, cookie, {
        knowledgePackageId,
        industryProfileId,
        entries: [{ keyword: "geo services", questions: ["What is a GEO service?", "How does GEO work?"] }],
      }, projectCtx);
      expect(map.status).toBe(200);
      expect(map.body.data.keywords).toEqual(["geo services"]);
      const keywordQuestionMapId: string = map.body.data.id;

      // 4. Opportunity (+ automated validation).
      const opp = await post(opportunitiesRoute as never, `${base}/opportunities`, cookie, {
        keywordQuestionMapId,
        keyword: "geo services",
      }, projectCtx);
      expect(opp.status).toBe(200);
      expect(opp.body.data.validation.status).toBe("VALIDATED");
      const opportunityId: string = opp.body.data.opportunity.id;
      const opportunityValidationId: string = opp.body.data.validation.id;

      // 5. Human review — CONFIRMED (never auto-approved: an explicit decision by the real,
      //    session-derived reviewer).
      const review = await post(
        opportunityReviewsRoute as never,
        `http://test/api/opportunities/${opportunityId}/reviews`,
        cookie,
        { opportunityValidationId, decision: "CONFIRMED" },
        { params: Promise.resolve({ id: opportunityId }) },
      );
      expect(review.status).toBe(200);
      expect(review.body.data.status).toBe("APPROVED");
      expect(review.body.data.reviewerId).toBe(adminUser);
      const humanReviewDecisionId: string = review.body.data.id;

      // 6. Opportunity family.
      const family = await post(opportunityFamiliesRoute as never, "http://test/api/opportunity-families", cookie, {
        projectId,
        members: [{ opportunityId, authorizingHumanReviewDecisionId: humanReviewDecisionId }],
      });
      expect(family.status).toBe(200);
      expect(family.body.data.memberOpportunityIds).toEqual([opportunityId]);
      const opportunityFamilyId: string = family.body.data.id;

      // 7. Article brief.
      const brief = await post(articleBriefsRoute as never, "http://test/api/article-briefs", cookie, {
        opportunityFamilyId,
        workingTitle: "The GEO Services Guide",
        outline: ["Introduction", "How it works"],
        targetKeywords: ["geo services"],
        riskLevel: "STANDARD",
      });
      expect(brief.status).toBe(200);
      const articleBriefId: string = brief.body.data.id;

      // 8. Compile draft (offline provider envelope — Provider Calls = 0).
      const draft = await post(compileDraftRoute as never, "http://test/api/article-drafts/compile", cookie, {
        articleBriefId,
        providerResponseEnvelopeId: "offline_envelope_1",
      });
      expect(draft.status).toBe(200);
      expect(draft.body.data.version).toBe(1);
      expect(draft.body.data.sectionCount).toBe(2);
      const articleDraftId: string = draft.body.data.id;

      // 9. Article approval (never auto-approved: a real, session-derived approver + three PASSED gates).
      const approval = await post(
        articleReviewsRoute as never,
        `http://test/api/article-drafts/${articleDraftId}/reviews`,
        cookie,
        { industryProfileId },
        { params: Promise.resolve({ id: articleDraftId }) },
      );
      expect(approval.status).toBe(200);
      expect(approval.body.data.approverId).toBe(adminUser);
      const articleApprovalId: string = approval.body.data.id;

      // 10. Publish package (default selected channel count = 0).
      const pub = await post(publishPackagesRoute as never, "http://test/api/publish-packages", cookie, {
        articleApprovalId,
        blocks: [{ kind: "PARAGRAPH", text: "GEO services explained.", order: 0 }],
      });
      expect(pub.status).toBe(200);
      expect(pub.body.data.channelNeutralContentPackage.selectedChannelCount).toBe(0);
      const channelNeutralContentPackageId: string = pub.body.data.channelNeutralContentPackage.id;
      const publishPackageId: string = pub.body.data.publishPackage.id;

      // 11. Distribution plan (human explicitly selects the channel).
      const plan = await post(distributionPlansRoute as never, "http://test/api/distribution-plans", cookie, {
        channelNeutralContentPackageId,
        channelIds: ["client_blog"],
        selectedByActorId: "user_publisher_kim",
      });
      expect(plan.status).toBe(200);
      expect(plan.body.data.channelIds).toEqual(["client_blog"]);
      const distributionPlanId: string = plan.body.data.id;

      // Invariant: a system/automatic publication actor is rejected.
      const autoReceipt = await post(publicationReceiptsRoute as never, "http://test/api/publication-receipts", cookie, {
        distributionPlanId,
        channelId: "client_blog",
        publishedByActorId: "system",
      });
      expect(autoReceipt.status).toBe(422);
      expect(autoReceipt.body.error.code).toBe("VALIDATION_FAILED");
      expect(await countRows("publication_receipt", "distribution_plan_id = $1", [distributionPlanId])).toBe(0);

      // 12. Publication receipt (real human actor).
      const receipt = await post(publicationReceiptsRoute as never, "http://test/api/publication-receipts", cookie, {
        distributionPlanId,
        channelId: "client_blog",
        publishedByActorId: "user_publisher_kim",
      });
      expect(receipt.status).toBe(200);
      expect(receipt.body.data.publishedByActorId).toBe("user_publisher_kim");
      const publicationReceiptId: string = receipt.body.data.id;

      // --- Persistence assertions --------------------------------------------------------------
      expect(await countRows("knowledge_package", "id = $1 AND status = 'DRAFT'", [knowledgePackageId])).toBe(1);
      expect(await countRows("industry_profile", "id = $1", [industryProfileId])).toBe(1);
      expect(await countRows("keyword_question_map", "id = $1", [keywordQuestionMapId])).toBe(1);
      expect(await countRows("opportunity", "id = $1", [opportunityId])).toBe(1);
      expect(await countRows("opportunity_validation", "id = $1 AND status = 'VALIDATED'", [opportunityValidationId])).toBe(1);
      expect(await countRows("human_review_decision", "id = $1 AND decision = 'APPROVED'", [humanReviewDecisionId])).toBe(1);
      expect(await countRows("opportunity_family", "id = $1", [opportunityFamilyId])).toBe(1);
      expect(await countRows("article_brief", "id = $1", [articleBriefId])).toBe(1);
      expect(await countRows("article_draft", "id = $1 AND version = 1", [articleDraftId])).toBe(1);
      expect(await countRows("provider_article_content", "article_brief_id = $1", [articleBriefId])).toBe(1);
      expect(await countRows("article_approval", "id = $1", [articleApprovalId])).toBe(1);
      expect(await countRows("publish_package", "id = $1", [publishPackageId])).toBe(1);
      expect(await countRows("distribution_plan", "id = $1", [distributionPlanId])).toBe(1);
      expect(await countRows("publication_receipt", "id = $1 AND published_by_actor_id = 'user_publisher_kim'", [publicationReceiptId])).toBe(1);
      expect(await countRows("delivery", "publication_receipt_id = $1", [publicationReceiptId])).toBe(1);

      // Everything landed under the right tenant.
      expect(await countRows("opportunity", "id = $1 AND client_organization_id = $2 AND project_id = $3", [opportunityId, clientOrg, projectId])).toBe(1);

      // --- Domain audit-trail assertions -------------------------------------------------------
      // The knowledge-audit-gap closure: knowledge_package.created emitted through the wrapper.
      expect(await auditCount("knowledge_package.created")).toBe(1);
      // Representative domain events across the chain.
      expect(await auditCount("industry_profile.created")).toBe(1);
      expect(await auditCount("keyword_question_map.created")).toBe(1);
      expect(await auditCount("opportunity.created")).toBe(1);
      expect(await auditCount("opportunity.validated")).toBe(1);
      expect(await auditCount("human_review.confirmed")).toBe(1);
      expect(await auditCount("opportunity_family.created")).toBe(1);
      expect(await auditCount("article_brief.created")).toBe(1);
      expect(await auditCount("provider_article_content.ingested")).toBe(1);
      expect(await auditCount("article_draft.compiled")).toBe(1);
      expect(await auditCount("quality_gate.passed")).toBe(1);
      expect(await auditCount("platform_gate.passed")).toBe(1);
      expect(await auditCount("vertical_gate.passed")).toBe(1);
      expect(await auditCount("article.approved")).toBe(1);
      expect(await auditCount("publish_package.created")).toBe(1);
      expect(await auditCount("channel_neutral_content_package.created")).toBe(1);
      expect(await auditCount("distribution_plan.created")).toBe(1);
      expect(await auditCount("publication_receipt.recorded")).toBe(1);

      // Every command carried an ALLOWED command-level audit (idempotency ledger + result DTO).
      const allowedCommands = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_event
         WHERE action LIKE '%.command.%' AND metadata->>'outcome' = 'ALLOWED'`,
      );
      expect(Number(allowedCommands.rows[0]!.n)).toBeGreaterThanOrEqual(12);
    });

    it("rejects an unauthenticated command with 401 and writes nothing", async () => {
      const adminUser = await createUser("pf-401@example.test");
      const platformOrg = await createOrg("PLATFORM", "pf-401", "Platform 401", adminUser);
      await createMembership(adminUser, platformOrg, "PLATFORM_SUPER_ADMIN");
      const clientOrg = await createOrg("CLIENT", "cl-401", "Client 401", adminUser);
      const projectId = await createProject(clientOrg, "P401", adminUser);

      const res = await post(
        knowledgePackagesRoute as never,
        `http://test/api/commands/projects/${projectId}/knowledge-packages`,
        null,
        { title: "Nope" },
        { params: Promise.resolve({ projectId }) },
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
      expect(await countRows("knowledge_package", "project_id = $1", [projectId])).toBe(0);
    });

    it("rejects a cross-tenant command with 403 and a DENIED audit row", async () => {
      const adminUser = await createUser("pf-403@example.test");
      const platformOrg = await createOrg("PLATFORM", "pf-403", "Platform 403", adminUser);
      await createMembership(adminUser, platformOrg, "PLATFORM_SUPER_ADMIN");

      // The project's tenant.
      const clientA = await createOrg("CLIENT", "cl-a-403", "Client A", adminUser);
      const projectId = await createProject(clientA, "Client A Project", adminUser);

      // A foreign client owner that must never touch Client A's project.
      const foreignUser = await createUser("foreign-owner@example.test");
      const clientB = await createOrg("CLIENT", "cl-b-403", "Client B", foreignUser);
      await createMembership(foreignUser, clientB, "CLIENT_OWNER");
      const foreignCookie = await loginAndGetCookie("foreign-owner@example.test");

      const res = await post(
        enterpriseProfileRoute as never,
        `http://test/api/commands/projects/${projectId}/enterprise-profile`,
        foreignCookie,
        {
          verticalSlug: "sneaky",
          verticalLabel: "Sneaky",
          validationGateLevel: "PLATFORM_WIDE_GATE",
          ruleSetVersion: 1,
        },
        { params: Promise.resolve({ projectId }) },
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");

      // Nothing was created for Client A.
      expect(await countRows("industry_profile", "project_id = $1", [projectId])).toBe(0);

      // A DENIED audit row records the real denied actor.
      const denied = await db.query<{ outcome: string }>(
        `SELECT metadata->>'outcome' AS outcome FROM audit_event
         WHERE actor_user_id = $1 AND action = 'industry_profile.command.create'`,
        [foreignUser],
      );
      expect(denied.rows).toHaveLength(1);
      expect(denied.rows[0]!.outcome).toBe("DENIED");
    });

    it("never auto-approves a human review: a request without an explicit decision is rejected 422", async () => {
      const adminUser = await createUser("pf-review@example.test");
      const platformOrg = await createOrg("PLATFORM", "pf-review", "Platform Review", adminUser);
      await createMembership(adminUser, platformOrg, "PLATFORM_SUPER_ADMIN");
      const cookie = await loginAndGetCookie("pf-review@example.test");
      const clientOrg = await createOrg("CLIENT", "cl-review", "Client Review", adminUser);
      const projectId = await createProject(clientOrg, "Review Project", adminUser);
      const base = `http://test/api/commands/projects/${projectId}`;
      const projectCtx = { params: Promise.resolve({ projectId }) };

      const kp = await post(knowledgePackagesRoute as never, `${base}/knowledge-packages`, cookie, { title: "K" }, projectCtx);
      const profile = await post(enterpriseProfileRoute as never, `${base}/enterprise-profile`, cookie, {
        verticalSlug: "v", verticalLabel: "V", validationGateLevel: "INDUSTRY_VERTICAL_GATE", ruleSetVersion: 1,
      }, projectCtx);
      const map = await post(keywordMapsRoute as never, `${base}/keyword-maps`, cookie, {
        knowledgePackageId: kp.body.data.id,
        industryProfileId: profile.body.data.id,
        entries: [{ keyword: "k", questions: ["q?"] }],
      }, projectCtx);
      const opp = await post(opportunitiesRoute as never, `${base}/opportunities`, cookie, {
        keywordQuestionMapId: map.body.data.id, keyword: "k",
      }, projectCtx);
      const opportunityId: string = opp.body.data.opportunity.id;
      const opportunityValidationId: string = opp.body.data.validation.id;

      // No explicit decision -> 422; nothing is silently approved and no decision is written.
      const res = await post(
        opportunityReviewsRoute as never,
        `http://test/api/opportunities/${opportunityId}/reviews`,
        cookie,
        { opportunityValidationId },
        { params: Promise.resolve({ id: opportunityId }) },
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
      expect(await countRows("human_review_decision", "opportunity_id = $1", [opportunityId])).toBe(0);
    });

    it("honours Idempotency-Key: two knowledge-package creates with one key yield ONE package", async () => {
      const adminUser = await createUser("pf-idem@example.test");
      const platformOrg = await createOrg("PLATFORM", "pf-idem", "Platform Idem", adminUser);
      await createMembership(adminUser, platformOrg, "PLATFORM_SUPER_ADMIN");
      const cookie = await loginAndGetCookie("pf-idem@example.test");
      const clientOrg = await createOrg("CLIENT", "cl-idem", "Client Idem", adminUser);
      const projectId = await createProject(clientOrg, "Idem Project", adminUser);
      const url = `http://test/api/commands/projects/${projectId}/knowledge-packages`;
      const projectCtx = { params: Promise.resolve({ projectId }) };

      const first = await post(knowledgePackagesRoute as never, url, cookie, { title: "Idem Pkg" }, projectCtx, { "idempotency-key": "idem-kp-1" });
      const second = await post(knowledgePackagesRoute as never, url, cookie, { title: "Idem Pkg" }, projectCtx, { "idempotency-key": "idem-kp-1" });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.data.id).toBe(second.body.data.id);

      // Exactly one package for the project, and exactly one knowledge_package.created audit.
      expect(await countRows("knowledge_package", "project_id = $1", [projectId])).toBe(1);
      expect(await auditCount("knowledge_package.created")).toBe(1);
    });
  },
);
