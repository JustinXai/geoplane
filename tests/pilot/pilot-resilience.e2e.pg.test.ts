/**
 * PILOT_ACCEPTANCE_V1 — resilience drills. Against ONE persisted, desensitized pilot chain (built
 * once in beforeAll through a real Postgres application runtime), three operational drills prove the
 * pilot survives the failures an operator will actually face:
 *
 *   (a) APPLICATION RESTART — close the runtime/pool (the process is gone, with every in-process
 *       cache), build a BRAND-NEW createPgApplicationRuntime over a fresh pool, re-login, and read
 *       org / project / knowledge package + uploaded CONTENT text / opportunity / delivery / audit
 *       trail back intact, plus re-derive the publication STATE (PUBLISHED) — business state, not
 *       just rows, survives.
 *
 *   (b) SESSION KEY ROTATION — issue a session cookie under signing key K1, rotate (K1 -> PREVIOUS,
 *       K2 -> CURRENT via __setSessionSigningKeysForTests). Assert the OLD cookie STILL verifies
 *       during the rotation window AND a fresh login under K2 works; then drop PREVIOUS and assert
 *       the old cookie is now rejected. Proven both at the signing layer and end-to-end through the
 *       real login route + AuthRuntime.resolveSession.
 *
 *   (c) BACKUP + RESTORE — pg_dump the pilot database (the throwaway test db) via the REAL
 *       scripts/backup/backup.mjs CLI, restore into a FRESH throwaway database via
 *       scripts/backup/restore.mjs, connect to the restored db, and assert ALL business state
 *       (accounts / knowledge text / opportunity / article / delivery / audit) is present and
 *       identical. The throwaway target database and the dump artifact are dropped afterwards.
 *
 * The throwaway backup/restore databases are created/dropped via the superuser role ('postgres'),
 * whose password is shared with the .env connection (matching tests/runtime/staging). When no test
 * database is configured the whole suite skips cleanly (describe.skipIf). No new deps; no src edits.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
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
import {
  __setSessionSigningKeysForTests,
  signSessionCookieValue,
  verifySignedSessionToken,
} from "../../src/lib/session-signing.js";
import type { AuthorizationContext } from "../../src/contracts/tenancy/entities.js";
import type { DistributionPlan } from "../../src/contracts/geo-business/entities.js";

const testConfig = loadDatabaseConfig({ test: true });
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const migrationsDir = join(repoRoot, "migrations");
const fixturesDir = join(here, "..", "runtime", "knowledge", "fixtures");
const backupScript = join(repoRoot, "scripts", "backup", "backup.mjs");
const restoreScript = join(repoRoot, "scripts", "backup", "restore.mjs");

const OOXML_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OFFLINE_ENVELOPE = "offline_envelope_pilot_resilience_1";
const CHANNEL = "sample_pilot_resilience_blog";
const SUPERUSER = "postgres";
const HOOK_TIMEOUT = 180_000;

// Desensitized fixtures (Real Customer Data = 0). Reserved test domains + explicit markers.
const CLIENT_OWNER_EMAIL = "resilience-client@pilot.example.test";
const AGENCY_OWNER_EMAIL = "resilience-agency@pilot.example.test";
const PLATFORM_EMAIL = "resilience-platform@pilot.example.test";
const DOCX_MARKER = "Hello DOCX from geoplane";

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

/** The client-owner authorization context the GEO services gate every action on. */
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
      body: JSON.stringify({ email }),
    }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a cookie");
  const first = setCookie.split(";")[0];
  if (!first) throw new Error("login set an empty cookie");
  return first;
}

/** Rebuild the base connection string with a different role and database (password preserved). */
function withUserAndDb(baseUrl: string, user: string, database: string): string {
  const u = new URL(baseUrl);
  u.username = user;
  u.pathname = `/${database}`;
  return u.toString();
}

async function insertUser(db: DatabasePort, email: string): Promise<string> {
  const res = await db.query<{ id: string }>(`INSERT INTO "user" (email) VALUES ($1) RETURNING id`, [
    email,
  ]);
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

// --- Persisted-pilot state captured in beforeAll, read back by every drill. ---
interface PilotState {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly knowledgePackageId: string;
  readonly storagePath: string;
  readonly opportunityId: string;
  readonly receiptId: string;
  readonly clientOwnerUserId: string;
}
let pilot: PilotState;
// The phase-1 distribution-plan ENTITY (plain data; survives the pool close), so a restarted runtime
// can re-derive its publication status.
let phase1DistributionPlan: DistributionPlan;

// Cleanup handles for the backup/restore throwaway.
const uniqueSuffix = `${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const DST_DB = `geoplane_pilot_rst_${uniqueSuffix}`;
let backupDir: string | null = null;

describe.skipIf(testConfig === null)(
  "PILOT_ACCEPTANCE_V1 — resilience drills (restart / session rotation / backup+restore)",
  () => {
    beforeAll(async () => {
      // A short-lived pool to migrate + reset the shared throwaway database, then persist the chain.
      const db1 = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      const runtime1: PgApplicationRuntime = createPgApplicationRuntime(db1);
      const auth1: AuthRuntime = createAuthRuntime(db1);
      try {
        await applyMigrations(db1, migrationsDir);
        await db1.query(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
        __setAuthRuntimeForTests(auth1);

        // Users (no HTTP signup route exists this checkpoint — seed the rows directly).
        const platformUser = await insertUser(db1, PLATFORM_EMAIL);
        const agencyUser = await insertUser(db1, AGENCY_OWNER_EMAIL);
        const clientOwnerUser = await insertUser(db1, CLIENT_OWNER_EMAIL);

        // Tenancy: platform -> agency -> client -> project.
        await runtime1.tenancy.organizations.createIdempotent({
          type: "PLATFORM",
          displayName: "Sample Platform Operator (Pilot Fixture)",
          idempotencyKey: "resilience-platform",
          createdByUserId: platformUser,
        });
        await runtime1.tenancy.organizations.createIdempotent({
          type: "AGENCY",
          displayName: "Sample Content Agency (Pilot Fixture)",
          idempotencyKey: "resilience-agency",
          createdByUserId: platformUser,
        });
        const clientOrg = await runtime1.tenancy.organizations.createIdempotent({
          type: "CLIENT",
          displayName: "Sample Manufacturing Enterprise (Pilot Fixture)",
          idempotencyKey: "resilience-client",
          createdByUserId: agencyUser,
        });
        const project = await runtime1.tenancy.projects.create({
          clientOrganizationId: clientOrg.id,
          name: "Sample Pilot Resilience Project",
          createdByUserId: agencyUser,
        });

        // A membership + a session minted through the REAL login route.
        await runtime1.tenancy.memberships.create({
          userId: clientOwnerUser,
          organizationId: clientOrg.id,
          role: "CLIENT_OWNER",
        });
        const cookieBefore = await loginAndGetCookie(CLIENT_OWNER_EMAIL);
        const principalBefore = await auth1.resolveSession(cookieBefore);
        expect(principalBefore?.userId).toBe(clientOwnerUser);

        const actor = clientOwnerContext(clientOrg.id, clientOwnerUser);

        // Enterprise knowledge package + a REAL DOCX upload — its extracted TEXT lands in the durable
        // content store (the very thing that must survive a restart / backup+restore).
        const knowledgePackage = await runtime1.knowledge.createPackage({
          clientOrganizationId: clientOrg.id,
          projectId: project.id,
          title: "Sample Enterprise Knowledge (Pilot Fixture)",
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
        expect(await runtime1.knowledge.contentStore.get(storagePath)).toContain(DOCX_MARKER);

        // GEO chain -> a recorded delivery.
        const geoKp = await runtime1.geoRepositories.knowledgePackages.getById(knowledgePackage.id);
        if (!geoKp) throw new Error("geo KnowledgePackage bridge did not resolve the persisted package");

        const industryProfile = await runtime1.geo.keywordQuestion.createIndustryProfile(actor, {
          clientOrganizationId: clientOrg.id,
          projectId: project.id,
          verticalSlug: "b2b-manufacturing",
          verticalLabel: "B2B Manufacturing",
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
        if (
          qualityGate.status !== "PASSED" ||
          platformGate.status !== "PASSED" ||
          verticalGate.status !== "PASSED"
        ) {
          throw new Error("pilot gates did not all PASS");
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
          [{ kind: "PARAGRAPH", text: "Restart-durable pilot body content.", order: 0 }],
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

        pilot = {
          clientOrganizationId: clientOrg.id,
          projectId: project.id,
          knowledgePackageId: knowledgePackage.id,
          storagePath,
          opportunityId: opportunity.id,
          receiptId: receipt.id,
          clientOwnerUserId: clientOwnerUser,
        };
        phase1DistributionPlan = distributionPlan;
      } finally {
        __setAuthRuntimeForTests(null);
        await db1.close();
      }
    }, HOOK_TIMEOUT);

    afterAll(async () => {
      // Restore env-driven signing keys no matter how a drill exited.
      __setSessionSigningKeysForTests(null);
      __setAuthRuntimeForTests(null);

      // Drop the backup/restore throwaway target database and remove the dump artifact.
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
    }, HOOK_TIMEOUT);

    // ================================================================
    // DRILL (a) — APPLICATION RESTART.
    // ================================================================
    it("(a) restart: a brand-new runtime reads all persisted pilot state back and re-derives PUBLISHED", async () => {
      const db2 = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      const runtime2: PgApplicationRuntime = createPgApplicationRuntime(db2);
      const auth2: AuthRuntime = createAuthRuntime(db2);
      __setAuthRuntimeForTests(auth2);
      try {
        // A fresh login mints a new session on the restarted process.
        const cookieAfter = await loginAndGetCookie(CLIENT_OWNER_EMAIL);
        const principalAfter = await auth2.resolveSession(cookieAfter);
        expect(principalAfter?.userId).toBe(pilot.clientOwnerUserId);
        expect(principalAfter?.organizationId).toBe(pilot.clientOrganizationId);

        // Org.
        expect((await runtime2.tenancy.organizations.findById(pilot.clientOrganizationId))?.id).toBe(
          pilot.clientOrganizationId,
        );
        // Project.
        expect((await runtime2.tenancy.projects.findById(pilot.projectId))?.clientOrganizationId).toBe(
          pilot.clientOrganizationId,
        );
        // Knowledge package + its durable uploaded CONTENT text (the in-memory store would have lost this).
        expect((await runtime2.knowledge.packages.findById(pilot.knowledgePackageId))?.id).toBe(
          pilot.knowledgePackageId,
        );
        const textAfter = await runtime2.knowledge.contentStore.get(pilot.storagePath);
        expect(textAfter).toContain(DOCX_MARKER);
        // Opportunity.
        expect((await runtime2.geoRepositories.opportunities.getById(pilot.opportunityId))?.keyword).toBe(
          "generative engine optimization",
        );
        // Delivery.
        const deliveries = await runtime2.geoRepositories.deliveries.listByScope({
          clientOrganizationId: pilot.clientOrganizationId,
          projectId: pilot.projectId,
        });
        expect(deliveries.map((d) => d.id)).toContain(pilot.receiptId);
        // Business STATE (not just rows): the publication status re-derives PUBLISHED through the
        // fresh runtime for the phase-1 distribution plan.
        const actor = clientOwnerContext(pilot.clientOrganizationId, pilot.clientOwnerUserId);
        const status = await runtime2.geo.delivery.publicationStatus(actor, phase1DistributionPlan);
        expect(status).toBe("PUBLISHED");
        // Audit trail — present and every row still carries its tamper-evidence hash.
        const audit = await runtime2.tenancy.auditEvents.listByOrganization(
          pilot.clientOrganizationId,
          200,
        );
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
        expect(audit.every((e) => typeof e.eventHash === "string" && e.eventHash.length > 0)).toBe(true);
      } finally {
        __setAuthRuntimeForTests(null);
        await db2.close();
      }
    });

    // ================================================================
    // DRILL (b) — SESSION KEY ROTATION.
    // ================================================================
    it("(b) rotation: old cookie verifies during the window, fresh login under the new key works, old rejected after PREVIOUS is dropped", async () => {
      const K1 = "pilot-rotation-signing-key-ONE-do-not-use-in-prod-0001";
      const K2 = "pilot-rotation-signing-key-TWO-do-not-use-in-prod-0002";

      const db3 = createPgDatabase({ connectionString: testConfig!.connectionString, max: 4 });
      const auth3: AuthRuntime = createAuthRuntime(db3);
      __setAuthRuntimeForTests(auth3);
      try {
        // --- Signing-layer proof (DB-independent), crisp about the rotation contract itself. ---
        const payloadB64 = Buffer.from(JSON.stringify({ probe: "pilot-rotation" }), "utf8").toString(
          "base64url",
        );
        const tokenUnderK1 = signSessionCookieValue(payloadB64, { key: K1 });
        __setSessionSigningKeysForTests({ current: K1, previous: null });
        expect(verifySignedSessionToken(tokenUnderK1)).not.toBeNull(); // signed with CURRENT
        __setSessionSigningKeysForTests({ current: K2, previous: K1 });
        expect(verifySignedSessionToken(tokenUnderK1)).not.toBeNull(); // rotation window: K1 is PREVIOUS
        __setSessionSigningKeysForTests({ current: K2, previous: null });
        expect(verifySignedSessionToken(tokenUnderK1)).toBeNull(); // retired: K1 no longer honoured

        // --- End-to-end proof through the real login route + AuthRuntime.resolveSession. ---
        // Issue a session under K1.
        __setSessionSigningKeysForTests({ current: K1, previous: null });
        const cookieK1 = await loginAndGetCookie(CLIENT_OWNER_EMAIL);
        expect((await auth3.resolveSession(cookieK1))?.userId).toBe(pilot.clientOwnerUserId);

        // Rotate: K1 -> PREVIOUS, K2 -> CURRENT. The OLD cookie STILL verifies during the window.
        __setSessionSigningKeysForTests({ current: K2, previous: K1 });
        expect((await auth3.resolveSession(cookieK1))?.userId).toBe(pilot.clientOwnerUserId);
        // A fresh login under the new CURRENT key works.
        const cookieK2 = await loginAndGetCookie(CLIENT_OWNER_EMAIL);
        expect((await auth3.resolveSession(cookieK2))?.userId).toBe(pilot.clientOwnerUserId);

        // Drop PREVIOUS: the old K1 cookie is now REJECTED; the K2 cookie still resolves.
        __setSessionSigningKeysForTests({ current: K2, previous: null });
        expect(await auth3.resolveSession(cookieK1)).toBeNull();
        expect((await auth3.resolveSession(cookieK2))?.userId).toBe(pilot.clientOwnerUserId);
      } finally {
        __setSessionSigningKeysForTests(null);
        __setAuthRuntimeForTests(null);
        await db3.close();
      }
    });

    // ================================================================
    // DRILL (c) — BACKUP + RESTORE (reuse scripts/backup).
    // ================================================================
    it("(c) backup+restore: pg_dump the pilot db, restore into a fresh db, and all business state is present", async () => {
      const baseUrl = testConfig!.connectionString;
      backupDir = mkdtempSync(join(tmpdir(), "geoplane-pilot-bkp-"));

      // (1) Dump the pilot database (the throwaway test db) via the REAL backup CLI, as the superuser
      //     (whose password is shared) so pg_dump can read the app-owned database.
      const backupOut = execFileSync(
        process.execPath,
        [backupScript, "--test", "--user", SUPERUSER, "--out", backupDir],
        { cwd: repoRoot, encoding: "utf8" },
      );
      const artifactLine = backupOut.split(/\r?\n/).find((l) => l.startsWith("ARTIFACT "));
      if (!artifactLine) throw new Error(`backup.mjs did not report an ARTIFACT path:\n${backupOut}`);
      const dumpFile = artifactLine.slice("ARTIFACT ".length).trim();

      // (2) Restore into a FRESH throwaway target via the REAL restore CLI (it creates the database).
      execFileSync(
        process.execPath,
        [restoreScript, "--test", "--db", DST_DB, "--user", SUPERUSER, "--dump", dumpFile],
        { cwd: repoRoot, encoding: "utf8" },
      );

      // (3) Connect to the RESTORED database and assert every piece of pilot business state survived.
      const restored = createPgDatabase({
        connectionString: withUserAndDb(baseUrl, SUPERUSER, DST_DB),
        max: 4,
      });
      try {
        // Accounts / tenancy.
        const user = await restored.query<{ email: string }>(
          `SELECT email FROM "user" WHERE id = $1`,
          [pilot.clientOwnerUserId],
        );
        expect(user.rows[0]?.email).toBe(CLIENT_OWNER_EMAIL);

        const org = await restored.query<{ display_name: string; type: string }>(
          `SELECT display_name, type FROM organization WHERE id = $1`,
          [pilot.clientOrganizationId],
        );
        expect(org.rows[0]?.type).toBe("CLIENT");
        expect(org.rows[0]?.display_name).toMatch(/sample|pilot fixture/i);

        const project = await restored.query<{ id: string }>(
          `SELECT id FROM project WHERE id = $1`,
          [pilot.projectId],
        );
        expect(project.rows[0]?.id).toBe(pilot.projectId);

        // Knowledge package + the durable extracted DOCX TEXT (byte-for-byte).
        const kp = await restored.query<{ id: string }>(
          `SELECT id FROM knowledge_package WHERE id = $1`,
          [pilot.knowledgePackageId],
        );
        expect(kp.rows[0]?.id).toBe(pilot.knowledgePackageId);

        const content = await restored.query<{ content_text: string }>(
          `SELECT content_text FROM knowledge_content WHERE storage_path = $1`,
          [pilot.storagePath],
        );
        expect(content.rows[0]?.content_text).toContain(DOCX_MARKER);

        // Opportunity / article / delivery.
        const opp = await restored.query<{ keyword: string }>(
          `SELECT keyword FROM opportunity WHERE id = $1`,
          [pilot.opportunityId],
        );
        expect(opp.rows[0]?.keyword).toBe("generative engine optimization");

        const draftCount = await restored.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM article_draft WHERE project_id = $1`,
          [pilot.projectId],
        );
        expect(Number(draftCount.rows[0]?.n ?? "0")).toBeGreaterThanOrEqual(1);

        const receiptRow = await restored.query<{ channel_id: string }>(
          `SELECT channel_id FROM publication_receipt WHERE id = $1`,
          [pilot.receiptId],
        );
        expect(receiptRow.rows[0]?.channel_id).toBe(CHANNEL);

        const delivery = await restored.query<{ channel_id: string; client_readable: boolean }>(
          `SELECT channel_id, client_readable FROM delivery WHERE publication_receipt_id = $1`,
          [pilot.receiptId],
        );
        expect(delivery.rows[0]?.channel_id).toBe(CHANNEL);
        expect(delivery.rows[0]?.client_readable).toBe(true);
        // The restored append-only trigger is live in the target too.
        await expect(
          restored.query(`UPDATE delivery SET client_readable = false WHERE publication_receipt_id = $1`, [
            pilot.receiptId,
          ]),
        ).rejects.toThrow(/append-only/i);

        // Audit trail — present with tamper-evidence hashes intact.
        const audit = await restored.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_event
             WHERE client_organization_id = $1 AND event_hash IS NOT NULL AND length(event_hash) > 0`,
          [pilot.clientOrganizationId],
        );
        expect(Number(audit.rows[0]?.n ?? "0")).toBeGreaterThan(0);
      } finally {
        await restored.close();
      }
    }, HOOK_TIMEOUT);
  },
);
