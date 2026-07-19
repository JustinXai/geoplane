/**
 * PRODUCT_RESTART_E2E_PG — the hard product-runtime acceptance: data AND business state survive an
 * application restart.
 *
 * Phase 1 ("original process"): a shortened but COMPLETE business chain is persisted through a real
 * Postgres-backed application runtime (createPgApplicationRuntime over pool #1) — tenancy
 * (platform/agency/client orgs + project), a session (minted via the REAL login route), an
 * enterprise knowledge package with a REAL uploaded DOCX whose extracted TEXT is written to the
 * durable content store, and the full GEO chain through to a recorded publication receipt (a
 * DELIVERED article) plus its audit trail.
 *
 * Phase 2 (SIMULATE RESTART): the DatabasePort is closed (`pool.end()`) — the process is gone, and
 * with it every in-process cache (e.g. the pre-continuity in-memory content store would have lost
 * the uploaded text here).
 *
 * Phase 3 ("brand-new process"): a BRAND-NEW createPgApplicationRuntime is constructed over a FRESH
 * connection pool (#2), and a fresh auth runtime re-resolves the old session cookie AND mints a new
 * one via the login route. Then EVERY artifact created in phase 1 — org, project, knowledge package
 * + its uploaded CONTENT text, opportunity, delivery, and the audit trail — is read back through the
 * fresh runtime and asserted intact. The publication status is re-derived through the fresh runtime
 * (PUBLISHED), proving business state, not just raw rows, survives the restart.
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import {
  createPgApplicationRuntime,
  type PgApplicationRuntime,
} from "../../src/composition/pg-application-runtime.js";
import {
  createAuthRuntime,
  __setAuthRuntimeForTests,
  type AuthRuntime,
} from "../../src/runtime/auth/runtime-context.js";
import { POST as loginRoute } from "../../src/app/api/auth/login/route.js";
import { TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH } from "../helpers/auth-credentials.js";
import type { AuthorizationContext } from "../../src/contracts/tenancy/entities.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "knowledge", "fixtures");

const OOXML_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OFFLINE_ENVELOPE = "offline_envelope_restart_1";
const CHANNEL = "restart_official_blog";

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

/** The client-owner authorization context the GEO services gate every action on (identity from a real user). */
function clientOwnerContext(clientOrgId: string, userId: string): AuthorizationContext {
  return {
    actorUserId: userId,
    actorRole: "CLIENT_OWNER",
    organizationId: clientOrgId,
    organizationType: "CLIENT",
    activeProjectId: null,
    activeClientOrganizationId: clientOrgId,
    assignedClientOrganizationIds: [],
    allowedClientOrganizationIds: [],
    isPlatformAdmin: false,
    permissions: [],
  };
}

/** Runs POST /api/auth/login for `email` against the currently-injected auth runtime; returns the Cookie header value. */
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

/** Open pools tracked so afterAll can close any that a mid-test failure left behind (no double-close). */
const openPools = new Set<DatabasePort>();
function track(db: DatabasePort): DatabasePort {
  openPools.add(db);
  return db;
}
async function closeTracked(db: DatabasePort): Promise<void> {
  await db.close();
  openPools.delete(db);
}

describe.skipIf(testConfig === null)(
  "PRODUCT_RESTART_E2E_PG — data + business state survive an application restart",
  () => {
    beforeAll(async () => {
      // A short-lived pool just to migrate + reset the shared throwaway database once.
      const setup = createPgDatabase({ connectionString: testConfig!.connectionString, max: 2 });
      await applyMigrations(setup, migrationsDir);
      await setup.query(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
      await setup.close();
    });

    afterAll(async () => {
      __setAuthRuntimeForTests(null);
      for (const db of [...openPools]) {
        try {
          await closeTracked(db);
        } catch {
          // Already closed by the test body; ignore.
        }
      }
    });

    it("persists a full chain, closes the pool, and reads everything back through a brand-new runtime", async () => {
      // ================================================================
      // PHASE 1 — original process: build runtime over pool #1 and persist the chain.
      // ================================================================
      const db1 = track(createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 }));
      const runtime1: PgApplicationRuntime = createPgApplicationRuntime(db1);
      const auth1: AuthRuntime = createAuthRuntime(db1);
      __setAuthRuntimeForTests(auth1);

      // Users (no HTTP signup route exists this checkpoint — seed the rows directly).
      const platformUser = await insertUser(db1, "platform-restart@acme.test");
      const agencyUser = await insertUser(db1, "agency-restart@acme.test");
      const clientOwnerUser = await insertUser(db1, "owner-restart@client.test");

      // Tenancy: platform -> agency -> client -> project (persisted through the runtime).
      await runtime1.tenancy.organizations.createIdempotent({
        type: "PLATFORM",
        displayName: "Restart Platform",
        idempotencyKey: "restart-platform",
        createdByUserId: platformUser,
      });
      await runtime1.tenancy.organizations.createIdempotent({
        type: "AGENCY",
        displayName: "Restart Agency",
        idempotencyKey: "restart-agency",
        createdByUserId: platformUser,
      });
      const clientOrg = await runtime1.tenancy.organizations.createIdempotent({
        type: "CLIENT",
        displayName: "Restart Client Enterprise",
        idempotencyKey: "restart-client",
        createdByUserId: agencyUser,
      });
      const project = await runtime1.tenancy.projects.create({
        clientOrganizationId: clientOrg.id,
        name: "Restart Main Project",
        createdByUserId: agencyUser,
      });

      // A membership + a session minted through the REAL login route (so we can prove the session
      // resolves before AND after the restart).
      await runtime1.tenancy.memberships.create({
        userId: clientOwnerUser,
        organizationId: clientOrg.id,
        role: "CLIENT_OWNER",
      });
      const cookieBefore = await loginAndGetCookie("owner-restart@client.test");
      const principalBefore = await auth1.resolveSession(cookieBefore);
      expect(principalBefore?.userId).toBe(clientOwnerUser);

      const actor = clientOwnerContext(clientOrg.id, clientOwnerUser);

      // Enterprise knowledge package + a REAL DOCX upload — its extracted TEXT lands in the durable
      // content store (the very thing that must survive the restart).
      const knowledgePackage = await runtime1.knowledge.createPackage({
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
        title: "Restart Enterprise Knowledge",
        createdByUserId: clientOwnerUser,
      });
      const docxBytes = readFileSync(join(fixturesDir, "sample.docx"));
      const ingest = await runtime1.knowledge.ingestion.ingest({
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
        packageId: knowledgePackage.id,
        title: "sample.docx",
        createdByUserId: clientOwnerUser,
        source: { filename: "sample.docx", contentType: OOXML_DOCX, bytes: docxBytes },
      });
      expect(ingest.outcome).toBe("INGESTED");
      const storagePath = await versionStoragePath(db1, knowledgePackage.id);
      expect(storagePath).toBeTruthy();
      // Sanity: the content is readable NOW (through pool #1) before we simulate the restart.
      expect(await runtime1.knowledge.contentStore.get(storagePath)).toContain("Hello DOCX from geoplane");

      // GEO chain -> a recorded delivery (single source of truth: the geo KnowledgePackage bridge
      // resolves the SAME persisted knowledge_package row).
      const geoKp = await runtime1.geoRepositories.knowledgePackages.getById(knowledgePackage.id);
      if (!geoKp) throw new Error("geo KnowledgePackage bridge did not resolve the persisted package");

      const industryProfile = await runtime1.geo.keywordQuestion.createIndustryProfile(actor, {
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
        verticalSlug: "b2b-saas",
        verticalLabel: "B2B SaaS",
        validationGateLevel: "INDUSTRY_VERTICAL_GATE",
        ruleSetVersion: 1,
      });
      const keywordQuestionMap = await runtime1.geo.keywordQuestion.createKeywordQuestionMap(actor, {
        knowledgePackage: geoKp,
        industryProfileId: industryProfile.id,
        entries: [
          {
            keyword: "generative engine optimization",
            questions: ["what is generative engine optimization?", "how does GEO work?"],
          },
        ],
      });
      const opportunity = await runtime1.geo.opportunity.createOpportunity(actor, {
        keywordQuestionMap,
        keyword: "generative engine optimization",
        knowledgePackage: geoKp,
      });
      const validation = await runtime1.geo.validation.validateOpportunity(actor, {
        opportunity,
        industryProfile,
        status: "VALIDATED",
        reasonNote: "Meets the vertical rule gate.",
      });
      const review = await runtime1.geo.humanReview.confirm(actor, validation, clientOwnerUser);
      expect(review.status).toBe("APPROVED");
      const family = await runtime1.geo.family.createFamily(actor, {
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
        members: [
          {
            opportunityId: opportunity.id,
            authorizingHumanReviewDecisionId: review.id,
            authorizingReviewDecisionStatus: "APPROVED",
          },
        ],
      });
      const brief = await runtime1.geo.brief.createBrief(actor, {
        family,
        workingTitle: "The state of generative engine optimization",
        outline: ["Introduction", "How answer engines rank content", "Conclusion"],
        targetKeywords: ["generative engine optimization"],
        riskLevel: "STANDARD",
      });
      const providerContent = await runtime1.geo.pipeline.ingestProviderArticleContent(
        actor,
        brief,
        OFFLINE_ENVELOPE,
      );
      const draft = await runtime1.geo.pipeline.compileDraft(actor, brief, [providerContent]);
      const qualityGate = await runtime1.geo.gates.evaluateQuality(actor, draft, brief);
      const platformGate = await runtime1.geo.gates.evaluatePlatformGate(actor, draft, industryProfile);
      const verticalGate = await runtime1.geo.gates.evaluateVerticalGate(actor, draft, industryProfile);
      expect(qualityGate.status).toBe("PASSED");
      expect(platformGate.status).toBe("PASSED");
      expect(verticalGate.status).toBe("PASSED");
      if (
        qualityGate.status !== "PASSED" ||
        platformGate.status !== "PASSED" ||
        verticalGate.status !== "PASSED"
      ) {
        throw new Error("unreachable: gates asserted PASSED above");
      }
      const approval = await runtime1.geo.gates.approveArticle(
        actor,
        draft,
        clientOwnerUser,
        qualityGate,
        platformGate,
        verticalGate,
      );
      const publishPackage = await runtime1.geo.publish.createPublishPackage(actor, approval, draft);
      const channelNeutralPackage = await runtime1.geo.publish.createChannelNeutralPackage(
        actor,
        publishPackage,
        [{ kind: "PARAGRAPH", text: "Restart-durable body content.", order: 0 }],
      );
      const distributionPlan = await runtime1.geo.distribution.createDistributionPlan(actor, {
        channelNeutralPackage,
        channelIds: [CHANNEL],
        selectedByActorId: clientOwnerUser,
      });
      const receipt = await runtime1.geo.delivery.recordPublicationReceipt(
        actor,
        distributionPlan,
        CHANNEL,
        clientOwnerUser,
      );

      // Capture the ids/values we will re-read after the restart.
      const clientOrgId = clientOrg.id;
      const projectId = project.id;
      const knowledgePackageId = knowledgePackage.id;
      const opportunityId = opportunity.id;
      const receiptId = receipt.id;

      // ================================================================
      // PHASE 2 — SIMULATE APPLICATION RESTART: tear down the pool/runtime.
      // ================================================================
      await closeTracked(db1);

      // ================================================================
      // PHASE 3 — brand-new process: fresh pool #2 + fresh runtime + fresh auth runtime.
      // ================================================================
      const db2 = track(createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 }));
      const runtime2: PgApplicationRuntime = createPgApplicationRuntime(db2);
      const auth2: AuthRuntime = createAuthRuntime(db2);
      __setAuthRuntimeForTests(auth2);

      // Sessions survive: the OLD cookie still resolves to the same principal through the fresh runtime.
      const principalAfter = await auth2.resolveSession(cookieBefore);
      expect(principalAfter?.userId).toBe(clientOwnerUser);
      expect(principalAfter?.organizationId).toBe(clientOrgId);
      // And a fresh login mints a new session on the restarted process.
      const cookieAfter = await loginAndGetCookie("owner-restart@client.test");
      expect(cookieAfter).toBeTruthy();

      // --- ALL previously-created data is still readable through the FRESH runtime. ---
      // Org.
      expect((await runtime2.tenancy.organizations.findById(clientOrgId))?.id).toBe(clientOrgId);
      // Project.
      expect((await runtime2.tenancy.projects.findById(projectId))?.clientOrganizationId).toBe(clientOrgId);
      // Knowledge package.
      expect((await runtime2.knowledge.packages.findById(knowledgePackageId))?.id).toBe(knowledgePackageId);
      // Uploaded CONTENT text — the durable-content-store round-trip over a brand-new pool. This is
      // the exact gap the in-memory store had: the extracted DOCX text survives the restart.
      const textAfter = await runtime2.knowledge.contentStore.get(storagePath);
      expect(textAfter).toContain("Hello DOCX from geoplane");
      // Opportunity.
      expect((await runtime2.geoRepositories.opportunities.getById(opportunityId))?.keyword).toBe(
        "generative engine optimization",
      );
      // Delivery.
      const deliveries = await runtime2.geoRepositories.deliveries.listByScope({
        clientOrganizationId: clientOrgId,
        projectId,
      });
      expect(deliveries.map((d) => d.id)).toContain(receiptId);
      // Business STATE (not just rows): the publication status re-derives as PUBLISHED through the
      // fresh runtime for the phase-1 distribution plan.
      const status = await runtime2.geo.delivery.publicationStatus(actor, distributionPlan);
      expect(status).toBe("PUBLISHED");
      // Audit trail.
      const audit = await runtime2.tenancy.auditEvents.listByOrganization(clientOrgId, 200);
      const actions = new Set(audit.map((e) => e.action));
      for (const expected of [
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
        "article.approved",
        "publish_package.created",
        "distribution_plan.created",
        "publication_receipt.recorded",
      ]) {
        expect(actions.has(expected), `audit trail should still contain "${expected}"`).toBe(true);
      }
      // Every surviving audit row still carries its tamper-evidence hash.
      expect(audit.every((e) => typeof e.eventHash === "string" && e.eventHash.length > 0)).toBe(true);

      await closeTracked(db2);
    });
  },
);

// --- helpers ---------------------------------------------------------------

async function insertUser(db: DatabasePort, email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [email, TEST_LOGIN_PASSWORD_HASH],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function versionStoragePath(db: DatabasePort, packageId: string): Promise<string> {
  const res = await db.query<{ storage_path: string | null }>(
    `SELECT storage_path FROM knowledge_version WHERE package_id = $1 ORDER BY version_number LIMIT 1`,
    [packageId],
  );
  const path = res.rows[0]?.storage_path;
  if (!path) throw new Error("no storage_path found for the ingested knowledge version");
  return path;
}
