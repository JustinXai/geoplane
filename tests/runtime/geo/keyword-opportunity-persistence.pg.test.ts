/**
 * KEYWORD_OPPORTUNITY_RUNTIME_V1 — real-Postgres persistence tests for the first
 * GEO business-chain slice (keyword -> opportunity -> validation -> human-review)
 * behind the E1 ports, backed by migrations/0003_geo_runtime.sql.
 *
 * Runs against GEO_TEST_DATABASE_URL (a throwaway database). When no test
 * database is configured the whole suite skips cleanly, exactly like the
 * tenancy pg suite — the DB-less unit suites are unaffected.
 *
 * Proves, for real (not in application code):
 *   1. migration 0003 applies via applyMigrations and the four aggregates persist.
 *   2. a KeywordQuestionMap round-trips with its keyword/question child rows.
 *   3. an Opportunity, an OpportunityValidation, and an (APPROVED)
 *      HumanReviewDecision persist and round-trip through the adapters.
 *   4. there is NO code path that yields an approved review state without an
 *      explicit reviewer: a raw INSERT of an APPROVED row with a null reviewer
 *      is rejected by the database.
 *   5. UPDATE and DELETE on the append-only history tables
 *      (opportunity_validation, human_review_decision) are rejected by trigger.
 *   6. tenant scoping: client A's opportunity is invisible to client B.
 *
 * Provider calls = 0: this module imports no provider/network surface — there
 * is no such port in the GEO runtime. This suite is persistence-only.
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import type {
  HumanReviewDecision,
  KeywordQuestionMap,
  Opportunity,
  OpportunityValidation,
} from "../../../src/contracts/geo-business/entities.js";
import { PgHumanReviewRepository } from "../../../src/runtime/geo/pg/human-review-repository.js";
import { PgKeywordQuestionMapRepository } from "../../../src/runtime/geo/pg/keyword-question-map-repository.js";
import { PgOpportunityRepository } from "../../../src/runtime/geo/pg/opportunity-repository.js";
import { PgOpportunityValidationRepository } from "../../../src/runtime/geo/pg/opportunity-validation-repository.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

const NOW = "2026-07-18T00:00:00.000Z";

let db: DatabasePort;

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createClientOrg(idempotencyKey: string, userId: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO organization (type, display_name, idempotency_key, created_by_user_id)
     VALUES ('CLIENT', $1, $2, $3) RETURNING id`,
    [idempotencyKey, idempotencyKey, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("organization insert returned no row");
  return row.id;
}

async function createProject(clientOrgId: string, userId: string, name: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO project (client_organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [clientOrgId, name, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("project insert returned no row");
  return row.id;
}

interface Tenant {
  readonly orgId: string;
  readonly projectId: string;
  readonly userId: string;
}

async function bootstrapTenant(key: string): Promise<Tenant> {
  const userId = await createUser(`${key}@example.test`);
  const orgId = await createClientOrg(`client-${key}`, userId);
  const projectId = await createProject(orgId, userId, `Project ${key}`);
  return { orgId, projectId, userId };
}

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

function buildOpportunity(t: Tenant, mapId: string): Opportunity {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    keywordQuestionMapId: mapId,
    keyword: "generative engine optimization",
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

function buildApproved(
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

describe.skipIf(testConfig === null)(
  "KEYWORD_OPPORTUNITY_RUNTIME_V1 — real database persistence",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
    });

    afterAll(async () => {
      if (db) await db.close();
    });

    beforeEach(async () => {
      await db.query(
        `TRUNCATE human_review_decision, opportunity_validation, opportunity,
                  keyword_question_map_question, keyword_question_map_keyword,
                  keyword_question_map, project, organization, "user"
         RESTART IDENTITY CASCADE`,
      );
    });

    it("persists a KeywordQuestionMap with its keyword/question child rows and round-trips", async () => {
      const t = await bootstrapTenant("a");
      const repo = new PgKeywordQuestionMapRepository(db);
      const map = buildMap(t);

      await repo.add(map);
      const fetched = await repo.getById(map.id);

      expect(fetched).toEqual(map);
      // Child rows really landed in the normalized tables.
      const keywords = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM keyword_question_map_keyword WHERE keyword_question_map_id = $1`,
        [map.id],
      );
      const questions = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM keyword_question_map_question WHERE keyword_question_map_id = $1`,
        [map.id],
      );
      expect(keywords.rows[0]?.n).toBe("2");
      expect(questions.rows[0]?.n).toBe("3");
    });

    it("rejects a duplicate KeywordQuestionMap id (append-only)", async () => {
      const t = await bootstrapTenant("a");
      const repo = new PgKeywordQuestionMapRepository(db);
      const map = buildMap(t);
      await repo.add(map);
      await expect(repo.add(map)).rejects.toThrow(/append-only/i);
    });

    it("persists and round-trips opportunity -> validation -> approved human review", async () => {
      const t = await bootstrapTenant("a");
      const mapRepo = new PgKeywordQuestionMapRepository(db);
      const oppRepo = new PgOpportunityRepository(db);
      const valRepo = new PgOpportunityValidationRepository(db);
      const reviewRepo = new PgHumanReviewRepository(db);

      const map = buildMap(t);
      await mapRepo.add(map);

      const opp = buildOpportunity(t, map.id);
      await oppRepo.add(opp);
      expect(await oppRepo.getById(opp.id)).toEqual(opp);

      const val = buildValidation(t, opp.id);
      await valRepo.add(val);
      expect(await valRepo.getById(val.id)).toEqual(val);

      const decision = buildApproved(t, opp.id, val.id);
      await reviewRepo.add(decision);
      const fetched = await reviewRepo.getById(decision.id);
      expect(fetched).toEqual(decision);
      // The approval carries a real, explicit reviewer identity.
      expect(fetched?.reviewerId).toBe(t.userId);
    });

    it("round-trips CHANGES_REQUESTED and REJECTED review variants", async () => {
      const t = await bootstrapTenant("a");
      const mapRepo = new PgKeywordQuestionMapRepository(db);
      const oppRepo = new PgOpportunityRepository(db);
      const valRepo = new PgOpportunityValidationRepository(db);
      const reviewRepo = new PgHumanReviewRepository(db);

      const map = buildMap(t);
      await mapRepo.add(map);
      const opp = buildOpportunity(t, map.id);
      await oppRepo.add(opp);
      const val = buildValidation(t, opp.id);
      await valRepo.add(val);

      const changes: HumanReviewDecision = {
        id: randomUUID(),
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
        opportunityId: opp.id,
        opportunityValidationId: val.id,
        status: "CHANGES_REQUESTED",
        reviewerId: t.userId,
        decidedAt: NOW,
        requestedChangesNote: "tighten the keyword grounding",
      };
      await reviewRepo.add(changes);
      expect(await reviewRepo.getById(changes.id)).toEqual(changes);

      const rejected: HumanReviewDecision = {
        id: randomUUID(),
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
        opportunityId: opp.id,
        opportunityValidationId: val.id,
        status: "REJECTED",
        reviewerId: t.userId,
        decidedAt: NOW,
        rejectionReasonNote: "out of vertical scope",
      };
      await reviewRepo.add(rejected);
      expect(await reviewRepo.getById(rejected.id)).toEqual(rejected);
    });

    it("makes a silently-approved review state unrepresentable: raw APPROVED insert with no reviewer is rejected", async () => {
      const t = await bootstrapTenant("a");
      const mapRepo = new PgKeywordQuestionMapRepository(db);
      const oppRepo = new PgOpportunityRepository(db);
      const valRepo = new PgOpportunityValidationRepository(db);

      const map = buildMap(t);
      await mapRepo.add(map);
      const opp = buildOpportunity(t, map.id);
      await oppRepo.add(opp);
      const val = buildValidation(t, opp.id);
      await valRepo.add(val);

      // Attempt to forge an approval with no reviewer identity, bypassing the
      // typed adapter entirely. The database refuses it — an APPROVED row can
      // never exist without an explicit reviewer_user_id (+ decided_at).
      await expect(
        db.query(
          `INSERT INTO human_review_decision
             (id, client_organization_id, project_id, opportunity_id, opportunity_validation_id,
              decision, reviewer_user_id, decided_at)
           VALUES ($1, $2, $3, $4, $5, 'APPROVED', NULL, NULL)`,
          [randomUUID(), t.orgId, t.projectId, opp.id, val.id],
        ),
      ).rejects.toThrow();

      // And there is no decision row at all: nothing slipped through.
      const count = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM human_review_decision`,
      );
      expect(count.rows[0]?.n).toBe("0");
    });

    it("forbids UPDATE and DELETE on the append-only opportunity_validation table", async () => {
      const t = await bootstrapTenant("a");
      const mapRepo = new PgKeywordQuestionMapRepository(db);
      const oppRepo = new PgOpportunityRepository(db);
      const valRepo = new PgOpportunityValidationRepository(db);

      const map = buildMap(t);
      await mapRepo.add(map);
      const opp = buildOpportunity(t, map.id);
      await oppRepo.add(opp);
      const val = buildValidation(t, opp.id);
      await valRepo.add(val);

      await expect(
        db.query(`UPDATE opportunity_validation SET status = 'REJECTED' WHERE id = $1`, [val.id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM opportunity_validation WHERE id = $1`, [val.id]),
      ).rejects.toThrow(/append-only/i);

      // Untouched.
      expect((await valRepo.getById(val.id))?.status).toBe("VALIDATED");
    });

    it("forbids UPDATE and DELETE on the append-only human_review_decision table", async () => {
      const t = await bootstrapTenant("a");
      const mapRepo = new PgKeywordQuestionMapRepository(db);
      const oppRepo = new PgOpportunityRepository(db);
      const valRepo = new PgOpportunityValidationRepository(db);
      const reviewRepo = new PgHumanReviewRepository(db);

      const map = buildMap(t);
      await mapRepo.add(map);
      const opp = buildOpportunity(t, map.id);
      await oppRepo.add(opp);
      const val = buildValidation(t, opp.id);
      await valRepo.add(val);
      const decision = buildApproved(t, opp.id, val.id);
      await reviewRepo.add(decision);

      await expect(
        db.query(`UPDATE human_review_decision SET decision = 'REJECTED' WHERE id = $1`, [decision.id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM human_review_decision WHERE id = $1`, [decision.id]),
      ).rejects.toThrow(/append-only/i);

      expect((await reviewRepo.getById(decision.id))?.status).toBe("APPROVED");
    });

    it("isolates tenants: client A's opportunity is invisible to client B", async () => {
      const a = await bootstrapTenant("a");
      const b = await bootstrapTenant("b");
      const mapRepo = new PgKeywordQuestionMapRepository(db);
      const oppRepo = new PgOpportunityRepository(db);

      const mapA = buildMap(a);
      await mapRepo.add(mapA);
      const oppA = buildOpportunity(a, mapA.id);
      await oppRepo.add(oppA);

      const visibleToA = await oppRepo.listByScope({
        clientOrganizationId: a.orgId,
        projectId: a.projectId,
      });
      const visibleToB = await oppRepo.listByScope({
        clientOrganizationId: b.orgId,
        projectId: b.projectId,
      });

      expect(visibleToA.map((o) => o.id)).toEqual([oppA.id]);
      expect(visibleToB).toEqual([]);

      // Same for the keyword-question map listing.
      const mapsToB = await mapRepo.listByScope({
        clientOrganizationId: b.orgId,
        projectId: b.projectId,
      });
      expect(mapsToB).toEqual([]);
    });
  },
);
