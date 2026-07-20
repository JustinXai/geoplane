/**
 * Light gate + human review workflow test for local/p0-l-light-gate-review-closure-v1.
 * 
 * Tests the full flow:
 * 1. Human review decision on an Opportunity (CONFIRMED -> APPROVED)
 * 2. Light gate on an ArticleDraft (Quality/Platform/Vertical gates -> ArticleApproval)
 * 
 * Uses the LOCAL_CLIENT_OWNER_PASSWORD env var for credentials.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import {
  __setAuthRuntimeForTests,
  createAuthRuntime,
  type AuthRuntime,
} from "../../src/runtime/auth/runtime-context.js";
import {
  __setGeoRuntimeForTests,
  createGeoRuntime,
} from "../../src/runtime/geo/runtime-context.js";
import { TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH } from "../helpers/auth-credentials.js";
import { POST as loginRoute } from "../../src/app/api/auth/login/route.js";
import { POST as articleReviewsRoute } from "../../src/app/api/article-drafts/[id]/reviews/route.js";
import { POST as opportunityReviewsRoute } from "../../src/app/api/opportunities/[id]/reviews/route.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(__dirname, "..", "..", "migrations");

const ALL_TABLES = [
  "provider_execution","delivery","publication_receipt","distribution_plan",
  "channel_neutral_content_block","channel_neutral_content_package","publish_package",
  "article_approval","vertical_gate_result","platform_gate_result","quality_gate_result",
  "article_draft","article_brief","opportunity_family_member","opportunity_family",
  "provider_article_content","human_review_decision","opportunity_validation",
  "opportunity","keyword_question_map_question","keyword_question_map_keyword",
  "keyword_question_map","industry_profile","knowledge_content","knowledge_snapshot",
  "knowledge_issue","knowledge_version","knowledge_document","knowledge_package",
  "enterprise_profile","client_review_decision","audit_event","session","invitation",
  "project_membership","artifact_index","membership","agency_client_assignment",
  "project","organization",'"user"'
].join(", ");

describe.skipIf(testConfig === null)(
  "LIGHT_GATE_REVIEW_WORKFLOW_V1 — light gate passes and human review enters",
  () => {
    let db: DatabasePort;
    let authRuntime: AuthRuntime;
    let clientCookie: string;
    let userId: string;
    let orgId: string;
    let projectId: string;
    let industryProfileId: string;
    let opportunityId: string;
    let validationId: string;
    let humanReviewId: string;
    let draftId: string;

    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 4 });
      await applyMigrations(db, migrationsDir);
      await db.query("TRUNCATE " + ALL_TABLES + " RESTART IDENTITY CASCADE");

      authRuntime = createAuthRuntime(db);
      const geoRuntime = createGeoRuntime(db);
      __setAuthRuntimeForTests(authRuntime);
      __setGeoRuntimeForTests(geoRuntime);

      // Create test user
      const email = "client-owner@local-pilot.example.test";
      const userRes = await db.query(
        "INSERT INTO \"user\" (email, password_hash) VALUES ($1, $2) RETURNING id",
        [email, TEST_LOGIN_PASSWORD_HASH]
      );
      userId = userRes.rows[0]!.id;

      // Create org
      const org = await authRuntime.repos.organizations.createIdempotent({
        type: "CLIENT",
        displayName: "Local Pilot Test Org",
        idempotencyKey: "local-pilot-test",
        createdByUserId: userId,
      });
      orgId = org.id;
      await authRuntime.repos.memberships.create({
        userId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
      });

      // Create project
      projectId = "78a6309a-81d9-4e3a-a756-a56dbf76966e";
      await db.query(
        "INSERT INTO project (id, name, client_organization_id, created_by_user_id) " +
        "VALUES ($1, 'Local Pilot Project', $2, $3) ON CONFLICT (id) DO NOTHING",
        [projectId, orgId, userId]
      );

      // Create industry profile
      industryProfileId = randomUUID();
      await db.query(
        "INSERT INTO industry_profile (id, client_organization_id, project_id, vertical_slug, " +
        "vertical_label, validation_gate_level, rule_set_version) " +
        "VALUES ($1, $2, $3, 'b2b-saas', 'B2B SaaS', 'PLATFORM_WIDE_GATE', 1)",
        [industryProfileId, orgId, projectId]
      );

      // Login
      const loginRes = await loginRoute(
        new Request("http://test/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: TEST_LOGIN_PASSWORD }),
        })
      );
      expect(loginRes.status).toBe(200);
      clientCookie = loginRes.headers.get("set-cookie")!.split(";")[0]!;
    });

    afterAll(async () => {
      __setAuthRuntimeForTests(null);
      __setGeoRuntimeForTests(null);
      if (db) await db.close();
    });

    it("creates opportunity + validation for human review", async () => {
      const kmapId = randomUUID();
      const kpkgId = randomUUID();

      // Knowledge package (DRAFT status - no confirmed_at/confirmed_by_user_id required)
      await db.query(
        "INSERT INTO knowledge_package (id, client_organization_id, project_id, title, status, classification, created_by_user_id) " +
        "VALUES ($1, $2, $3, $4, 'DRAFT', 'INTERNAL', $5)",
        [kpkgId, orgId, projectId, "Test Knowledge Package", userId]
      );

      // Keyword map
      await db.query(
        "INSERT INTO keyword_question_map (id, client_organization_id, project_id, " +
        "knowledge_package_id, knowledge_package_version, industry_profile_id) " +
        "VALUES ($1, $2, $3, $4, 1, $5)",
        [kmapId, orgId, projectId, kpkgId, industryProfileId]
      );
      await db.query(
        "INSERT INTO keyword_question_map_keyword (id, client_organization_id, project_id, keyword_question_map_id, keyword, position) " +
        "VALUES ($1, $2, $3, $4, 'GEO testing', 0)",
        [randomUUID(), orgId, projectId, kmapId]
      );

      // Opportunity + validation
      opportunityId = randomUUID();
      validationId = randomUUID();
      await db.query(
        "INSERT INTO opportunity (id, client_organization_id, project_id, keyword_question_map_id, " +
        "keyword, grounding_knowledge_package_id, grounding_knowledge_package_version) " +
        "VALUES ($1, $2, $3, $4, 'GEO testing', $5, 1)",
        [opportunityId, orgId, projectId, kmapId, kpkgId]
      );
      await db.query(
        "INSERT INTO opportunity_validation (id, client_organization_id, project_id, opportunity_id, " +
        "status, industry_profile_id, gate_level_applied, reason_note, validated_at) " +
        "VALUES ($1, $2, $3, $4, 'VALIDATED', $5, 'PLATFORM_WIDE_GATE', 'meets gate', now())",
        [validationId, orgId, projectId, opportunityId, industryProfileId]
      );

      expect(opportunityId).toBeTruthy();
      expect(validationId).toBeTruthy();
    });

    it("human review CONFIRMED yields APPROVED decision", async () => {
      const res = await opportunityReviewsRoute(
        new Request("http://test/api/opportunities/" + opportunityId + "/reviews", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: clientCookie },
          body: JSON.stringify({
            opportunityValidationId: validationId,
            decision: "CONFIRMED",
          }),
        }),
        { params: Promise.resolve({ id: opportunityId }) }
      );

      console.log("Human review response status:", res.status);
      const body = await res.json();
      console.log("Human review response:", JSON.stringify(body, null, 2));

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe("APPROVED");
      expect(body.data.reviewerId).toBe(userId);
      humanReviewId = body.data.id;
    });

    it("creates family + brief + draft for light gate test", async () => {
      const familyId = randomUUID();
      const briefId = randomUUID();
      draftId = randomUUID();
      const providerContentId = randomUUID();
      const familyMemberId = randomUUID();

      // Family
      await db.query(
        "INSERT INTO opportunity_family (id, client_organization_id, project_id) " +
        "VALUES ($1, $2, $3)",
        [familyId, orgId, projectId]
      );

      // Family member (separate table)
      await db.query(
        "INSERT INTO opportunity_family_member (id, client_organization_id, project_id, opportunity_family_id, opportunity_id, authorizing_human_review_decision_id, authorizing_review_decision_status, position) " +
        "VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', 0)",
        [familyMemberId, orgId, projectId, familyId, opportunityId, humanReviewId]
      );

      // Brief
      await db.query(
        "INSERT INTO article_brief (id, client_organization_id, project_id, opportunity_family_id, " +
        "working_title, outline, planning_schema_version, planning_opportunity_family_id, planning_risk_level, planning_target_keywords, planning_authorizing_hrd_ids) " +
        "VALUES ($1, $2, $3, $4, $5, ARRAY['Introduction', 'How GEO works', 'Conclusion'], 'ArticleBriefPlanningContextV1', $4, 'STANDARD', ARRAY['GEO testing'], ARRAY[$6::uuid])",
        [briefId, orgId, projectId, familyId, "The state of GEO testing", humanReviewId]
      );

      // Provider content
      await db.query(
        "INSERT INTO provider_article_content (id, client_organization_id, project_id, " +
        "article_brief_id, provider_response_envelope_id, version, received_at) " +
        "VALUES ($1, $2, $3, $4, $5, 1, now())",
        [providerContentId, orgId, projectId, briefId, "test-envelope"]
      );

      // Draft (with sections to pass gates)
      await db.query(
        "INSERT INTO article_draft (id, client_organization_id, project_id, article_brief_id, " +
        "version, title, section_headings, source_provider_article_content_ids, status, compiled_at) " +
        "VALUES ($1, $2, $3, $4, 1, $5, ARRAY['Introduction', 'How GEO works', 'Conclusion'], ARRAY[$6::uuid], 'DRAFT', now())",
        [draftId, orgId, projectId, briefId, "The state of GEO testing", providerContentId]
      );

      expect(draftId).toBeTruthy();
    });

    it("light gate PASSES and returns ArticleApproval", async () => {
      const res = await articleReviewsRoute(
        new Request("http://test/api/article-drafts/" + draftId + "/reviews", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: clientCookie },
          body: JSON.stringify({ industryProfileId }),
        }),
        { params: Promise.resolve({ id: draftId }) }
      );

      console.log("Light gate response status:", res.status);
      const body = await res.json();
      console.log("Light gate response:", JSON.stringify(body, null, 2));

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.id).toBeTruthy();
      expect(body.data.approverId).toBe(userId);
      expect(body.data.articleDraftId).toBe(draftId);

      // Verify gates were recorded
      const qualityGate = await db.query(
        "SELECT status FROM quality_gate_result WHERE article_draft_id = $1",
        [draftId]
      );
      const platformGate = await db.query(
        "SELECT status FROM platform_gate_result WHERE article_draft_id = $1",
        [draftId]
      );
      const verticalGate = await db.query(
        "SELECT status FROM vertical_gate_result WHERE article_draft_id = $1",
        [draftId]
      );

      console.log("Quality gate:", qualityGate.rows[0]?.status);
      console.log("Platform gate:", platformGate.rows[0]?.status);
      console.log("Vertical gate:", verticalGate.rows[0]?.status);

      expect(qualityGate.rows[0]?.status).toBe("PASSED");
      expect(platformGate.rows[0]?.status).toBe("PASSED");
      expect(verticalGate.rows[0]?.status).toBe("PASSED");
    });

    it("second light gate call is idempotent (no duplicate approval)", async () => {
      const res = await articleReviewsRoute(
        new Request("http://test/api/article-drafts/" + draftId + "/reviews", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: clientCookie },
          body: JSON.stringify({ industryProfileId }),
        }),
        { params: Promise.resolve({ id: draftId }) }
      );

      // Should either return 200 with same approval or 409 conflict
      const body = await res.json();
      console.log("Second gate call status:", res.status, JSON.stringify(body));

      // The idempotency key should make this idempotent, or return existing approval
      expect([200, 409]).toContain(res.status);
    });
  }
);
