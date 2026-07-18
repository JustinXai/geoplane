/**
 * Real-Postgres route tests for GEO_READ_API_V1 (Agent E4).
 *
 * These exercise the GEO read-side App Router handlers end-to-end against
 * GEO_TEST_DATABASE_URL. They seed users/orgs/memberships through the real
 * repositories, obtain a real session cookie via the auth login route, seed the
 * persisted GEO business chain through the E1-E3 Pg repositories + frozen
 * constructors, inject a GEO runtime pointed at the throwaway test database, then
 * invoke the exported handlers with `new Request(...)` and assert HTTP status +
 * the frozen DTO shapes + tenant isolation.
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
 *
 * Provider calls = 0: nothing in this read path imports a provider/network
 * surface — the GEO runtime has no such port — so this suite drives zero provider
 * calls by construction.
 *
 * Coverage:
 *   - GET keyword-questions -> KeywordQuestionViewV1[] (flattened, priority-ordered)
 *   - GET opportunities     -> OpportunityViewV1[] with derived status (VALIDATED / CONFIRMED)
 *   - GET review-queue      -> only the VALIDATED-but-unreviewed opportunity
 *   - GET deliveries        -> ArticleDeliveryViewV1[] with status DELIVERED
 *   - client-surface leak check: no grounding/knowledge-package/brief/hash internals
 *   - tenant isolation: client B reading client A's project -> 403 on every route
 *   - unauthenticated -> 401
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlatformRole } from "../../../src/contracts/tenancy/entities.js";
import {
  buildPublishPackage,
  createChannelNeutralContentPackage,
  createPublicationReceipt,
  type ArticleApproval,
  type ArticleBrief,
  type DistributionPlan,
  type DraftArticleDraft,
  type HumanReviewDecision,
  type KeywordQuestionMap,
  type Opportunity,
  type OpportunityFamily,
  type OpportunityValidation,
  type PassedPlatformGate,
  type PassedQualityGate,
  type PassedVerticalGate,
} from "../../../src/contracts/geo-business/entities.js";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import {
  __setAuthRuntimeForTests,
  createAuthRuntime,
  type AuthRuntime,
} from "../../../src/runtime/auth/runtime-context.js";
import {
  __setGeoRuntimeForTests,
  createGeoRuntime,
  type GeoRuntime,
} from "../../../src/runtime/geo/runtime-context.js";
import { PgArticleApprovalRepository } from "../../../src/runtime/geo/pg/article-approval-repository.js";
import { PgArticleBriefRepository } from "../../../src/runtime/geo/pg/article-brief-repository.js";
import { PgArticleDraftRepository } from "../../../src/runtime/geo/pg/article-draft-repository.js";
import { PgChannelNeutralContentPackageRepository } from "../../../src/runtime/geo/pg/channel-neutral-content-package-repository.js";
import { PgDeliveryRepository } from "../../../src/runtime/geo/pg/delivery-repository.js";
import { PgDistributionPlanRepository } from "../../../src/runtime/geo/pg/distribution-plan-repository.js";
import { PgHumanReviewRepository } from "../../../src/runtime/geo/pg/human-review-repository.js";
import { PgKeywordQuestionMapRepository } from "../../../src/runtime/geo/pg/keyword-question-map-repository.js";
import { PgOpportunityFamilyRepository } from "../../../src/runtime/geo/pg/opportunity-family-repository.js";
import { PgOpportunityRepository } from "../../../src/runtime/geo/pg/opportunity-repository.js";
import { PgOpportunityValidationRepository } from "../../../src/runtime/geo/pg/opportunity-validation-repository.js";
import { PgPlatformGateRepository } from "../../../src/runtime/geo/pg/platform-gate-repository.js";
import { PgPublishPackageRepository } from "../../../src/runtime/geo/pg/publish-package-repository.js";
import { PgQualityGateRepository } from "../../../src/runtime/geo/pg/quality-gate-repository.js";
import { PgVerticalGateRepository } from "../../../src/runtime/geo/pg/vertical-gate-repository.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { GET as keywordQuestionsRoute } from "../../../src/app/api/projects/[projectId]/keyword-questions/route.js";
import { GET as opportunitiesRoute } from "../../../src/app/api/projects/[projectId]/opportunities/route.js";
import { GET as reviewQueueRoute } from "../../../src/app/api/projects/[projectId]/review-queue/route.js";
import { GET as deliveriesRoute } from "../../../src/app/api/projects/[projectId]/deliveries/route.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

const NOW = "2026-07-18T00:00:00.000Z";

let db: DatabasePort;
let authRuntime: AuthRuntime;
let geoRuntime: GeoRuntime;

// --- seed helpers -----------------------------------------------------------

interface Tenant {
  readonly orgId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly email: string;
}

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createClientOrg(key: string, createdBy: string): Promise<string> {
  const org = await authRuntime.repos.organizations.createIdempotent({
    type: "CLIENT",
    displayName: key,
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

async function createProject(clientOrgId: string, userId: string, name: string): Promise<string> {
  const project = await authRuntime.repos.projects.create({
    clientOrganizationId: clientOrgId,
    name,
    createdByUserId: userId,
  });
  return project.id;
}

/** A full CLIENT tenant with an owner membership, ready to log in. */
async function bootstrapClientTenant(key: string): Promise<Tenant> {
  const email = `${key}@example.test`;
  const userId = await createUser(email);
  const orgId = await createClientOrg(`client-${key}`, userId);
  await createMembership(userId, orgId, "CLIENT_OWNER");
  const projectId = await createProject(orgId, userId, `Project ${key}`);
  return { orgId, projectId, userId, email };
}

/** Runs login for `email` and returns the reusable `name=value` Cookie header value. */
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

// --- GEO chain builders -----------------------------------------------------

function buildMap(t: Tenant): KeywordQuestionMap {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    knowledgePackageId: randomUUID(),
    knowledgePackageVersion: 1,
    industryProfileId: randomUUID(),
    entries: [
      { keyword: "generative engine optimization", questions: ["what is geo?", "how does geo work?"] },
      { keyword: "answer engines", questions: ["which answer engines matter?"] },
    ],
    createdAt: NOW,
  };
}

function buildOpportunity(t: Tenant, mapId: string, keyword: string): Opportunity {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    keywordQuestionMapId: mapId,
    keyword,
    groundingKnowledgePackageId: randomUUID(),
    groundingKnowledgePackageVersion: 1,
    createdAt: NOW,
  };
}

function buildValidation(t: Tenant, opportunityId: string): OpportunityValidation {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    opportunityId,
    status: "VALIDATED",
    industryProfileId: randomUUID(),
    gateLevelApplied: "INDUSTRY_VERTICAL_GATE",
    reasonNote: "meets the vertical rule gate",
    validatedAt: NOW,
  };
}

function buildApprovedReview(
  t: Tenant,
  opportunityId: string,
  validationId: string,
): HumanReviewDecision {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    opportunityId,
    opportunityValidationId: validationId,
    status: "APPROVED",
    reviewerId: t.userId,
    decidedAt: NOW,
  };
}

/** Persists the full article -> delivery chain for a tenant, ending in one DELIVERED article. */
async function persistDeliveredArticle(t: Tenant): Promise<void> {
  const familyRepo = new PgOpportunityFamilyRepository(db);
  const briefRepo = new PgArticleBriefRepository(db);
  const draftRepo = new PgArticleDraftRepository(db);
  const qualityRepo = new PgQualityGateRepository(db);
  const platformRepo = new PgPlatformGateRepository(db);
  const verticalRepo = new PgVerticalGateRepository(db);
  const approvalRepo = new PgArticleApprovalRepository(db);
  const publishRepo = new PgPublishPackageRepository(db);
  const cncRepo = new PgChannelNeutralContentPackageRepository(db);
  const planRepo = new PgDistributionPlanRepository(db);
  const deliveryRepo = new PgDeliveryRepository(db);

  const family: OpportunityFamily = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    members: [
      {
        opportunityId: randomUUID(),
        authorizingHumanReviewDecisionId: randomUUID(),
        authorizingReviewDecisionStatus: "APPROVED",
      },
    ],
    createdAt: NOW,
  };
  await familyRepo.add(family);

  const brief: ArticleBrief = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    opportunityFamilyId: family.id,
    planningContext: {
      schemaVersion: "ArticleBriefPlanningContextV1",
      opportunityFamilyId: family.id,
      authorizingHumanReviewDecisionIds: [randomUUID()],
      targetKeywords: ["generative engine optimization"],
      riskLevel: "STANDARD",
    },
    workingTitle: "The state of GEO",
    outline: ["Intro", "Body", "Conclusion"],
    createdAt: NOW,
  };
  await briefRepo.add(brief);

  const draft: DraftArticleDraft = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    articleBriefId: brief.id,
    sourceProviderArticleContentIds: [randomUUID()],
    version: 1,
    title: "The state of GEO",
    sections: [
      { heading: "Intro", order: 0 },
      { heading: "Body", order: 1 },
    ],
    status: "DRAFT",
    compiledAt: NOW,
  };
  await draftRepo.add(draft);

  const quality: PassedQualityGate = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    articleDraftId: draft.id,
    status: "PASSED",
    evaluatedAt: NOW,
  };
  const platform: PassedPlatformGate = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    gateKind: "PLATFORM_GATE",
    articleDraftId: draft.id,
    industryProfileId: randomUUID(),
    gateLevelApplied: "PLATFORM_WIDE_GATE",
    status: "PASSED",
    evaluatedAt: NOW,
  };
  const vertical: PassedVerticalGate = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    gateKind: "VERTICAL_GATE",
    articleDraftId: draft.id,
    industryProfileId: randomUUID(),
    gateLevelApplied: "INDUSTRY_VERTICAL_GATE",
    status: "PASSED",
    evaluatedAt: NOW,
  };
  await qualityRepo.add(quality);
  await platformRepo.add(platform);
  await verticalRepo.add(vertical);

  const approval: ArticleApproval = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    articleDraftId: draft.id,
    approverId: t.userId,
    approvedAt: NOW,
    qualityGateId: quality.id,
    qualityGateStatus: "PASSED",
    platformGateId: platform.id,
    platformGateStatus: "PASSED",
    verticalGateId: vertical.id,
    verticalGateStatus: "PASSED",
  };
  await approvalRepo.add(approval);

  const pkg = buildPublishPackage(approval, draft, { id: randomUUID(), builtAt: NOW });
  await publishRepo.add(pkg);

  const cnc = createChannelNeutralContentPackage(
    pkg,
    [{ kind: "HEADING", text: "The state of GEO", order: 0 }],
    { id: randomUUID(), createdAt: NOW },
  );
  await cncRepo.add(cnc);

  const plan: DistributionPlan = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    channelNeutralContentPackageId: cnc.id,
    channelIds: ["channel_neutral_hub"],
    selectedByActorId: "user_platform_jane",
    selectedAt: NOW,
  };
  await planRepo.add(plan);

  const receipt = createPublicationReceipt(plan, "channel_neutral_hub", "user_platform_jane", {
    id: randomUUID(),
    publishedAt: NOW,
  });
  await deliveryRepo.add(receipt);
}

/** Seeds keyword map + two opportunities (one VALIDATED-only, one CONFIRMED) + a delivered article. */
async function seedGeoChain(t: Tenant): Promise<{ opp1: Opportunity; opp2: Opportunity }> {
  const mapRepo = new PgKeywordQuestionMapRepository(db);
  const oppRepo = new PgOpportunityRepository(db);
  const valRepo = new PgOpportunityValidationRepository(db);
  const reviewRepo = new PgHumanReviewRepository(db);

  const map = buildMap(t);
  await mapRepo.add(map);

  // Opportunity 1: validated, NOT yet reviewed -> status VALIDATED, in the review queue.
  const opp1 = buildOpportunity(t, map.id, "generative engine optimization");
  await oppRepo.add(opp1);
  await valRepo.add(buildValidation(t, opp1.id));

  // Opportunity 2: validated AND approved -> status CONFIRMED, NOT in the review queue.
  const opp2 = buildOpportunity(t, map.id, "answer engines");
  await oppRepo.add(opp2);
  const val2 = buildValidation(t, opp2.id);
  await valRepo.add(val2);
  await reviewRepo.add(buildApprovedReview(t, opp2.id, val2.id));

  await persistDeliveredArticle(t);

  return { opp1, opp2 };
}

function req(projectId: string, path: string, cookie?: string): Request {
  return new Request(`http://test/api/projects/${projectId}/${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe.skipIf(testConfig === null)("GEO_READ_API_V1 — read routes over real Postgres", () => {
  beforeAll(async () => {
    db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
    await applyMigrations(db, migrationsDir);
    authRuntime = createAuthRuntime(db);
    geoRuntime = createGeoRuntime(db);
    __setAuthRuntimeForTests(authRuntime);
    __setGeoRuntimeForTests(geoRuntime);
  });

  afterAll(async () => {
    __setAuthRuntimeForTests(null);
    __setGeoRuntimeForTests(null);
    if (db) await db.close();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE delivery, publication_receipt, distribution_plan,
                channel_neutral_content_block, channel_neutral_content_package,
                publish_package, article_approval,
                vertical_gate_result, platform_gate_result, quality_gate_result,
                article_draft, article_brief,
                opportunity_family_member, opportunity_family,
                human_review_decision, opportunity_validation, opportunity,
                keyword_question_map_question, keyword_question_map_keyword, keyword_question_map,
                agency_client_assignment, session, membership, project, organization, "user"
       RESTART IDENTITY CASCADE`,
    );
  });

  it("serves keyword-questions, opportunities (with derived status), review-queue and deliveries; and isolates tenants", async () => {
    const a = await bootstrapClientTenant("a");
    const { opp1, opp2 } = await seedGeoChain(a);
    const cookieA = await loginAndGetCookie(a.email);

    // 1. keyword-questions -> flattened, priority-ordered KeywordQuestionViewV1[].
    const kqRes = await keywordQuestionsRoute(req(a.projectId, "keyword-questions", cookieA), {
      params: Promise.resolve({ projectId: a.projectId }),
    });
    expect(kqRes.status).toBe(200);
    const kq = await kqRes.json();
    expect(kq.ok).toBe(true);
    expect(kq.data).toHaveLength(2);
    expect(kq.data[0]).toEqual({
      keyword: "generative engine optimization",
      userQuestions: ["what is geo?", "how does geo work?"],
      priority: 1,
    });
    expect(kq.data[1].priority).toBe(2);

    // 2. opportunities -> derived status: opp1 VALIDATED, opp2 CONFIRMED.
    const oppRes = await opportunitiesRoute(req(a.projectId, "opportunities", cookieA), {
      params: Promise.resolve({ projectId: a.projectId }),
    });
    expect(oppRes.status).toBe(200);
    const oppBodyText = await oppRes.text();
    const oppBody = JSON.parse(oppBodyText);
    expect(oppBody.data).toHaveLength(2);
    const byId = new Map<string, { status: string; title: string; projectId: string }>(
      oppBody.data.map((o: { id: string; status: string; title: string; projectId: string }) => [
        o.id,
        o,
      ]),
    );
    expect(byId.get(opp1.id)?.status).toBe("VALIDATED");
    expect(byId.get(opp2.id)?.status).toBe("CONFIRMED");
    expect(byId.get(opp1.id)?.title).toBe("generative engine optimization");
    expect(byId.get(opp1.id)?.projectId).toBe(a.projectId);

    // Client-surface leak check: no grounding/provenance/brief/hash internals leak.
    for (const banned of [
      "grounding",
      "groundingKnowledgePackageId",
      "knowledgePackage",
      "keywordQuestionMapId",
      "articleBrief",
      "candidate",
      "chunk",
      "hash",
      "schema",
    ]) {
      expect(oppBodyText).not.toContain(banned);
    }

    // 3. review-queue -> only the VALIDATED-but-unreviewed opportunity (opp1).
    const rqRes = await reviewQueueRoute(req(a.projectId, "review-queue", cookieA), {
      params: Promise.resolve({ projectId: a.projectId }),
    });
    expect(rqRes.status).toBe(200);
    const rq = await rqRes.json();
    expect(rq.data).toHaveLength(1);
    expect(rq.data[0].id).toBe(opp1.id);
    expect(rq.data[0].status).toBe("VALIDATED");

    // 4. deliveries -> one DELIVERED article with a human title and both timestamps.
    const delRes = await deliveriesRoute(req(a.projectId, "deliveries", cookieA), {
      params: Promise.resolve({ projectId: a.projectId }),
    });
    expect(delRes.status).toBe(200);
    const del = await delRes.json();
    expect(del.data).toHaveLength(1);
    expect(del.data[0]).toMatchObject({
      title: "The state of GEO",
      status: "DELIVERED",
      projectId: a.projectId,
    });
    expect(del.data[0].deliveredAt).not.toBeNull();
    expect(del.data[0].publicationRegisteredAt).not.toBeNull();

    // 5. Tenant isolation: client B cannot read client A's project on any route -> 403.
    const b = await bootstrapClientTenant("b");
    const cookieB = await loginAndGetCookie(b.email);
    for (const [route, path] of [
      [keywordQuestionsRoute, "keyword-questions"],
      [opportunitiesRoute, "opportunities"],
      [reviewQueueRoute, "review-queue"],
      [deliveriesRoute, "deliveries"],
    ] as const) {
      const forbidden = await route(req(a.projectId, path, cookieB), {
        params: Promise.resolve({ projectId: a.projectId }),
      });
      expect(forbidden.status).toBe(403);
      const body = await forbidden.json();
      expect(body.error.code).toBe("FORBIDDEN");
    }
  });

  it("rejects an unauthenticated read -> 401", async () => {
    const a = await bootstrapClientTenant("a");
    const res = await opportunitiesRoute(req(a.projectId, "opportunities"), {
      params: Promise.resolve({ projectId: a.projectId }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 404 for an unknown project the caller could otherwise read", async () => {
    const a = await bootstrapClientTenant("a");
    const cookieA = await loginAndGetCookie(a.email);
    const unknown = randomUUID();
    const res = await opportunitiesRoute(req(unknown, "opportunities", cookieA), {
      params: Promise.resolve({ projectId: unknown }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
