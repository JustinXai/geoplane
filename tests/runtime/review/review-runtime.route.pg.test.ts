/**
 * Real-Postgres route tests for SAFE_REVIEW_REFERENCE_V1 + CLIENT_REVIEW_RUNTIME_V1 (Agent C2).
 *
 * Drives the read + write review surfaces end-to-end over GEO_TEST_DATABASE_URL by invoking the
 * exported App Router handlers with `new Request(...)`. Seeds users/orgs/memberships through the real
 * repositories, obtains a real session cookie via the auth login route, seeds opportunities +
 * validations through the E1 Pg repositories, injects both the auth and geo runtimes pointed at the
 * throwaway test database, then asserts every invariant this checkpoint must hold:
 *
 *   - GET opportunities / review-queue expose review.reviewReferenceCode for a reviewable opportunity,
 *     and the response body carries NO raw validation UUID (the code decodes back to it server-side);
 *   - a CONFIRMED review submitted via the OPAQUE code persists (human_review_decision = APPROVED)
 *     and audits with the REAL, session-derived actor;
 *   - a forged / tampered reference is rejected (422) with no write;
 *   - a stale reviewVersion -> 409 CONFLICT with no write;
 *   - DEFERRED / CHANGES_REQUESTED map correctly (held REJECTED / CHANGES_REQUESTED);
 *   - no silent auto-approve (a request without an explicit decision -> 422, nothing written);
 *   - unauthenticated -> 401; cross-tenant -> 403 + a DENIED audit row.
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlatformRole } from "../../../src/contracts/tenancy/entities.js";
import type {
  HumanReviewDecision,
  KeywordQuestionMap,
  Opportunity,
  OpportunityValidation,
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
import {
  decodeReviewReferenceCode,
  encodeReviewReferenceCode,
} from "../../../src/runtime/geo/review-reference.js";
import { PgHumanReviewRepository } from "../../../src/runtime/geo/pg/human-review-repository.js";
import { PgKeywordQuestionMapRepository } from "../../../src/runtime/geo/pg/keyword-question-map-repository.js";
import { PgOpportunityRepository } from "../../../src/runtime/geo/pg/opportunity-repository.js";
import { PgOpportunityValidationRepository } from "../../../src/runtime/geo/pg/opportunity-validation-repository.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { GET as opportunitiesRoute } from "../../../src/app/api/projects/[projectId]/opportunities/route.js";
import { GET as reviewQueueRoute } from "../../../src/app/api/projects/[projectId]/review-queue/route.js";
import { POST as reviewsRoute } from "../../../src/app/api/opportunities/[id]/reviews/route.js";

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

function buildMap(t: Tenant, keyword: string): KeywordQuestionMap {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    knowledgePackageId: randomUUID(),
    knowledgePackageVersion: 1,
    industryProfileId: randomUUID(),
    entries: [{ keyword, questions: [`what is ${keyword}?`] }],
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

/** Seeds a keyword map + one VALIDATED, unreviewed opportunity and returns its ids. */
async function seedReviewableOpportunity(
  t: Tenant,
  keyword: string,
): Promise<{ opportunityId: string; validationId: string }> {
  const map = buildMap(t, keyword);
  await new PgKeywordQuestionMapRepository(db).add(map);
  const opp = buildOpportunity(t, map.id, keyword);
  await new PgOpportunityRepository(db).add(opp);
  const validation = buildValidation(t, opp.id);
  await new PgOpportunityValidationRepository(db).add(validation);
  return { opportunityId: opp.id, validationId: validation.id };
}

function reviewPost(
  opportunityId: string,
  cookie: string | null,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...extraHeaders };
  if (cookie) headers["cookie"] = cookie;
  return reviewsRoute(
    new Request(`http://test/api/opportunities/${opportunityId}/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: opportunityId }) },
  );
}

async function postReview(
  opportunityId: string,
  cookie: string | null,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await reviewPost(opportunityId, cookie, body, extraHeaders);
  return { status: res.status, body: await res.json() };
}

function readReq(projectId: string, path: string, cookie?: string): Request {
  return new Request(`http://test/api/projects/${projectId}/${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

async function countDecisions(validationId: string): Promise<number> {
  const res = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM human_review_decision WHERE opportunity_validation_id = $1`,
    [validationId],
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

describe.skipIf(testConfig === null)(
  "SAFE_REVIEW_REFERENCE_V1 + CLIENT_REVIEW_RUNTIME_V1 — review routes over real Postgres",
  () => {
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
        `TRUNCATE audit_event, human_review_decision, opportunity_validation, opportunity,
                  keyword_question_map_question, keyword_question_map_keyword, keyword_question_map,
                  agency_client_assignment, session, membership, project, organization, "user"
         RESTART IDENTITY CASCADE`,
      );
    });

    it("exposes an OPAQUE review reference on opportunities + review-queue (no raw validation UUID) and it decodes back", async () => {
      const t = await bootstrapClientTenant("ref");
      const { opportunityId, validationId } = await seedReviewableOpportunity(t, "geo services");
      const cookie = await loginAndGetCookie(t.email);

      for (const [route, path] of [
        [opportunitiesRoute, "opportunities"],
        [reviewQueueRoute, "review-queue"],
      ] as const) {
        const res = await route(readReq(t.projectId, path, cookie), {
          params: Promise.resolve({ projectId: t.projectId }),
        });
        expect(res.status).toBe(200);
        const text = await res.text();
        // The raw validation UUID must never appear anywhere in the client-facing body.
        expect(text).not.toContain(validationId);

        const body = JSON.parse(text);
        const opp = body.data.find((o: { id: string }) => o.id === opportunityId);
        expect(opp, `${path} should list the reviewable opportunity`).toBeTruthy();
        expect(opp.review).toBeTruthy();
        expect(typeof opp.review.reviewReferenceCode).toBe("string");
        expect(opp.review.reviewVersion).toBe(0);
        expect(opp.review.reviewStatus).toBe("PENDING");
        expect(opp.review.allowedDecisions).toEqual(["CONFIRMED", "CHANGES_REQUESTED", "DEFERRED"]);
        // Server-side, the opaque code decodes back to the internal validation id.
        expect(decodeReviewReferenceCode(opp.review.reviewReferenceCode)).toBe(validationId);
      }
    });

    it("records a CONFIRMED review from the opaque code, persists APPROVED, and audits the real actor", async () => {
      const t = await bootstrapClientTenant("confirm");
      const { opportunityId, validationId } = await seedReviewableOpportunity(t, "answer engines");
      const cookie = await loginAndGetCookie(t.email);
      const code = encodeReviewReferenceCode(validationId);

      const res = await postReview(opportunityId, cookie, {
        reviewReferenceCode: code,
        reviewVersion: 0,
        decision: "CONFIRMED",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.status).toBe("APPROVED");
      expect(res.body.data.reviewerId).toBe(t.userId);
      // The response never carries the raw opaque code back or a client-supplied actor.
      expect(await countDecisions(validationId)).toBe(1);
      const persisted = await db.query<{ decision: string; reviewer_user_id: string }>(
        `SELECT decision, reviewer_user_id FROM human_review_decision WHERE opportunity_validation_id = $1`,
        [validationId],
      );
      expect(persisted.rows[0]!.decision).toBe("APPROVED");
      expect(persisted.rows[0]!.reviewer_user_id).toBe(t.userId);

      // Domain audit + command audit, both with the real actor.
      expect(await auditCount("human_review.confirmed")).toBe(1);
      const cmd = await db.query<{ actor: string; outcome: string }>(
        `SELECT actor_user_id AS actor, metadata->>'outcome' AS outcome
           FROM audit_event WHERE action = 'human_review.command.decide'`,
      );
      expect(cmd.rows).toHaveLength(1);
      expect(cmd.rows[0]!.actor).toBe(t.userId);
      expect(cmd.rows[0]!.outcome).toBe("ALLOWED");
    });

    it("rejects a forged / tampered reference with 422 and writes nothing", async () => {
      const t = await bootstrapClientTenant("forged");
      const { opportunityId, validationId } = await seedReviewableOpportunity(t, "forged keyword");
      const cookie = await loginAndGetCookie(t.email);

      const good = encodeReviewReferenceCode(validationId);
      const tampered = `${good.slice(0, -1)}${good.endsWith("A") ? "B" : "A"}`;

      const res = await postReview(opportunityId, cookie, {
        reviewReferenceCode: tampered,
        reviewVersion: 0,
        decision: "CONFIRMED",
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
      expect(await countDecisions(validationId)).toBe(0);
      expect(await auditCount("human_review.confirmed")).toBe(0);
    });

    it("rejects a stale reviewVersion with 409 CONFLICT and does not write", async () => {
      const t = await bootstrapClientTenant("stale");
      const { opportunityId, validationId } = await seedReviewableOpportunity(t, "stale keyword");
      const cookie = await loginAndGetCookie(t.email);

      // A decision already landed (version is now 1) — seed it directly.
      const existing: HumanReviewDecision = {
        id: randomUUID(),
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
        opportunityId,
        opportunityValidationId: validationId,
        status: "CHANGES_REQUESTED",
        reviewerId: t.userId,
        decidedAt: NOW,
        requestedChangesNote: "please add sources",
      };
      await new PgHumanReviewRepository(db).add(existing);
      expect(await countDecisions(validationId)).toBe(1);

      // The client still holds the stale version 0 -> conflict, no new write.
      const res = await postReview(opportunityId, cookie, {
        reviewReferenceCode: encodeReviewReferenceCode(validationId),
        reviewVersion: 0,
        decision: "CONFIRMED",
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(await countDecisions(validationId)).toBe(1);
      expect(await auditCount("human_review.confirmed")).toBe(0);
    });

    it("maps DEFERRED and CHANGES_REQUESTED to their held / changes outcomes", async () => {
      const t = await bootstrapClientTenant("map");
      const cookie = await loginAndGetCookie(t.email);

      const deferred = await seedReviewableOpportunity(t, "defer keyword");
      const changes = await seedReviewableOpportunity(t, "changes keyword");

      const deferRes = await postReview(deferred.opportunityId, cookie, {
        reviewReferenceCode: encodeReviewReferenceCode(deferred.validationId),
        reviewVersion: 0,
        decision: "DEFERRED",
        note: "暂不处理",
      });
      expect(deferRes.status).toBe(200);
      expect(deferRes.body.data.status).toBe("REJECTED");

      const changesRes = await postReview(changes.opportunityId, cookie, {
        reviewReferenceCode: encodeReviewReferenceCode(changes.validationId),
        reviewVersion: 0,
        decision: "CHANGES_REQUESTED",
        note: "请补充数据来源",
      });
      expect(changesRes.status).toBe(200);
      expect(changesRes.body.data.status).toBe("CHANGES_REQUESTED");

      const deferredRow = await db.query<{ decision: string; rejection_reason_note: string | null }>(
        `SELECT decision, rejection_reason_note FROM human_review_decision WHERE opportunity_validation_id = $1`,
        [deferred.validationId],
      );
      expect(deferredRow.rows[0]!.decision).toBe("REJECTED");
      expect(deferredRow.rows[0]!.rejection_reason_note).toBe("暂不处理");

      const changesRow = await db.query<{ decision: string; requested_changes_note: string | null }>(
        `SELECT decision, requested_changes_note FROM human_review_decision WHERE opportunity_validation_id = $1`,
        [changes.validationId],
      );
      expect(changesRow.rows[0]!.decision).toBe("CHANGES_REQUESTED");
      expect(changesRow.rows[0]!.requested_changes_note).toBe("请补充数据来源");
    });

    it("never auto-approves: a request without an explicit decision is rejected 422 and writes nothing", async () => {
      const t = await bootstrapClientTenant("noauto");
      const { opportunityId, validationId } = await seedReviewableOpportunity(t, "noauto keyword");
      const cookie = await loginAndGetCookie(t.email);

      const res = await postReview(opportunityId, cookie, {
        reviewReferenceCode: encodeReviewReferenceCode(validationId),
        reviewVersion: 0,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
      expect(await countDecisions(validationId)).toBe(0);
    });

    it("requires a note for a DEFERRED decision (422) — no held decision without a reason", async () => {
      const t = await bootstrapClientTenant("defernote");
      const { opportunityId, validationId } = await seedReviewableOpportunity(t, "defernote keyword");
      const cookie = await loginAndGetCookie(t.email);

      const res = await postReview(opportunityId, cookie, {
        reviewReferenceCode: encodeReviewReferenceCode(validationId),
        reviewVersion: 0,
        decision: "DEFERRED",
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
      expect(await countDecisions(validationId)).toBe(0);
    });

    it("rejects an unauthenticated review with 401 and writes nothing", async () => {
      const t = await bootstrapClientTenant("unauth");
      const { opportunityId, validationId } = await seedReviewableOpportunity(t, "unauth keyword");

      const res = await postReview(opportunityId, null, {
        reviewReferenceCode: encodeReviewReferenceCode(validationId),
        reviewVersion: 0,
        decision: "CONFIRMED",
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
      expect(await countDecisions(validationId)).toBe(0);
    });

    it("rejects a cross-tenant review with 403 + a DENIED audit row and writes nothing", async () => {
      const a = await bootstrapClientTenant("tenant-a");
      const { opportunityId, validationId } = await seedReviewableOpportunity(a, "tenant a keyword");

      const b = await bootstrapClientTenant("tenant-b");
      const cookieB = await loginAndGetCookie(b.email);

      const res = await postReview(opportunityId, cookieB, {
        reviewReferenceCode: encodeReviewReferenceCode(validationId),
        reviewVersion: 0,
        decision: "CONFIRMED",
      });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(await countDecisions(validationId)).toBe(0);

      const denied = await db.query<{ outcome: string }>(
        `SELECT metadata->>'outcome' AS outcome FROM audit_event
           WHERE actor_user_id = $1 AND action = 'human_review.command.decide'`,
        [b.userId],
      );
      expect(denied.rows).toHaveLength(1);
      expect(denied.rows[0]!.outcome).toBe("DENIED");
    });
  },
);
