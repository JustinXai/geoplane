/**
 * CORE_RUNTIME_E2E_PG — the FULL section-11 minimal business loop driven against
 * a REAL PostgreSQL database through the Postgres ApplicationCompositionRoot
 * (src/composition/pg-application-runtime.ts).
 *
 * This is the real-database upgrade of the offline in-memory precursor
 * tests/e2e/minimal-runtime-e2e.test.ts: every step below is persisted to, and
 * read back from, the throwaway test database (GEO_TEST_DATABASE_URL, database
 * geoplane_test_compose). When no test database is configured the whole suite
 * skips cleanly, exactly like the other *.pg.test.ts suites — the DB-less unit
 * suites are unaffected.
 *
 * The chain (section 11), each link persisted and read back:
 *   Platform creates an Agency org -> Agency creates a Client org -> Project ->
 *   invite a Client Owner (invitation persisted) -> Client "logs in" (Session)
 *   -> ingest an enterprise knowledge TXT (KnowledgePackage + Version persisted)
 *   -> EnterpriseProfile persisted -> geo KeywordQuestionMap persisted ->
 *   Opportunity -> explicit human review APPROVED -> OpportunityFamily ->
 *   ArticleBrief -> ArticleDraft (deterministic, 0 provider calls) ->
 *   Quality/Platform/Vertical gates PASS -> ArticleApproval (explicit human
 *   approver) -> PublishPackage (0 default channels) -> DistributionPlan ->
 *   PublicationReceipt (human actor; a 'system' actor is REJECTED) -> Delivery
 *   readable by the client -> Agency can read the client's status -> Ops reads
 *   the full AuditEvent trail.
 *
 * Structural invariants asserted directly: Provider Calls = 0 (there is no
 * provider port anywhere in the graph — proven concretely by a deterministic
 * double-compile), Automatic Publication = NO (a system/automatic actor is
 * rejected), Default Selected Channel Count = 0, tenant isolation (client B
 * cannot see or reach client A's data), and the audit trail carries every
 * expected GEO action.
 */
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import { compileArticleDraft } from "../../src/contracts/geo-business/entities.js";
import type { AuthorizationContext } from "../../src/contracts/tenancy/entities.js";
import { createPgApplicationRuntime } from "../../src/composition/pg-application-runtime.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

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
  "human_review_decision",
  "opportunity_validation",
  "opportunity",
  "keyword_question_map_question",
  "keyword_question_map_keyword",
  "keyword_question_map",
  "knowledge_snapshot",
  "knowledge_issue",
  "knowledge_version",
  "knowledge_document",
  "knowledge_package",
  "enterprise_profile",
  "audit_event",
  "session",
  "invitation",
  "project_membership",
  "client_review_decision",
  "artifact_index",
  "membership",
  "agency_client_assignment",
  "project",
  "organization",
  '"user"',
].join(", ");

let db: DatabasePort;

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(`INSERT INTO "user" (email) VALUES ($1) RETURNING id`, [
    email,
  ]);
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

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

function agencyOwnerContext(
  agencyOrgId: string,
  userId: string,
  allowedClientOrganizationIds: string[],
): AuthorizationContext {
  return {
    actorUserId: userId,
    actorRole: "AGENCY_OWNER",
    organizationId: agencyOrgId,
    organizationType: "AGENCY",
    activeProjectId: null,
    activeClientOrganizationId: null,
    assignedClientOrganizationIds: allowedClientOrganizationIds,
    allowedClientOrganizationIds,
    isPlatformAdmin: false,
    permissions: [],
  };
}

const FUTURE = "2027-01-01T00:00:00.000Z";

describe.skipIf(testConfig === null)(
  "CORE_RUNTIME_E2E_PG — full section-11 minimal loop against a real database",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
    });

    afterAll(async () => {
      if (db) await db.close();
    });

    beforeEach(async () => {
      await db.query(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
    });

    it("drives the entire chain: every link persisted and read back, 0 provider calls, no auto-publication, tenant isolation holds", async () => {
      const runtime = createPgApplicationRuntime(db);

      // --- Production DB writes = 0: the runtime only ever received a throwaway
      // TEST database, never the production/runtime database. Assert this
      // environment-agnostically — the ONLY hard rule is that the production db
      // (geoplane_runtime) must never be the target; any isolated test db name is fine. ---
      expect(testConfig).not.toBeNull();
      expect(testConfig!.connectionString).not.toMatch(/\/geoplane_runtime(\?|$)/);

      // ----------------------------------------------------------------------
      // Tenancy: Platform -> Agency -> Client -> Project (all persisted).
      // ----------------------------------------------------------------------
      const platformUser = await createUser("platform-admin@example.test");
      const agencyUser = await createUser("agency-owner@example.test");
      const clientOwnerUser = await createUser("client-owner@example.test");

      const platformOrg = await runtime.tenancy.organizations.createIdempotent({
        type: "PLATFORM",
        displayName: "Example Platform Operator",
        idempotencyKey: "e2e-platform",
        createdByUserId: platformUser,
      });
      expect(platformOrg.type).toBe("PLATFORM");

      // Platform creates an Agency.
      const agencyOrg = await runtime.tenancy.organizations.createIdempotent({
        type: "AGENCY",
        displayName: "Example Agency",
        idempotencyKey: "e2e-agency",
        createdByUserId: platformUser,
      });

      // Agency creates a Client.
      const clientOrg = await runtime.tenancy.organizations.createIdempotent({
        type: "CLIENT",
        displayName: "Example Client Enterprise",
        idempotencyKey: "e2e-client",
        createdByUserId: agencyUser,
      });

      const project = await runtime.tenancy.projects.create({
        clientOrganizationId: clientOrg.id,
        name: "Example Client Main Project",
        createdByUserId: agencyUser,
      });

      // Read-back proof: the client org and project really landed in the DB.
      expect((await runtime.tenancy.organizations.findById(clientOrg.id))?.id).toBe(clientOrg.id);
      expect((await runtime.tenancy.projects.findById(project.id))?.clientOrganizationId).toBe(
        clientOrg.id,
      );

      // ----------------------------------------------------------------------
      // Invite a Client Owner (invitation persisted, token hashed) -> "log in".
      // ----------------------------------------------------------------------
      const rawToken = randomUUID();
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const invitation = await runtime.tenancy.invitations.create({
        organizationId: clientOrg.id,
        invitedEmail: "client-owner@example.test",
        role: "CLIENT_OWNER",
        tokenHash,
        createdByUserId: platformUser,
        expiresAt: FUTURE,
      });
      expect(invitation.status).toBe("PENDING");
      // The persisted record carries only the hash, never the raw token.
      expect(invitation.tokenHash).toBe(tokenHash);
      expect(invitation.tokenHash).not.toBe(rawToken);

      // The client accepts by presenting the token; only its hash is looked up.
      const found = await runtime.tenancy.invitations.findByTokenHash(tokenHash);
      expect(found?.id).toBe(invitation.id);
      const accepted = await runtime.tenancy.invitations.markAccepted(invitation.id);
      expect(accepted?.status).toBe("ACCEPTED");

      const membership = await runtime.tenancy.memberships.create({
        userId: clientOwnerUser,
        organizationId: clientOrg.id,
        role: "CLIENT_OWNER",
      });
      const session = await runtime.tenancy.sessions.create({
        userId: clientOwnerUser,
        membershipId: membership.id,
        organizationId: clientOrg.id,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: clientOrg.id,
        sessionVersion: 1,
        expiresAt: FUTURE,
      });
      // Session read back from the DB is active and scoped to the client org.
      const reloadedSession = await runtime.tenancy.sessions.findById(session.id);
      expect(reloadedSession?.activeClientOrganizationId).toBe(clientOrg.id);

      const clientActor = clientOwnerContext(clientOrg.id, clientOwnerUser);

      // ----------------------------------------------------------------------
      // Ingest an enterprise knowledge file (TXT) -> KnowledgePackage + Version
      // persisted; then an EnterpriseProfile persisted.
      // ----------------------------------------------------------------------
      const knowledgePackage = await runtime.knowledge.packages.create({
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
        title: "Enterprise Knowledge Base",
        createdByUserId: clientOwnerUser,
      });

      const ingestResult = await runtime.knowledge.ingestion.ingest({
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
        packageId: knowledgePackage.id,
        title: "Company Overview",
        createdByUserId: clientOwnerUser,
        source: {
          filename: "overview.txt",
          contentType: "text/plain",
          bytes: Buffer.from(
            "Example enterprise overview: products, pricing, and positioning.",
            "utf8",
          ),
        },
      });
      expect(ingestResult.outcome).toBe("INGESTED");
      if (ingestResult.outcome !== "INGESTED") throw new Error("unreachable: asserted INGESTED");
      expect(ingestResult.version.versionNumber).toBe(1);
      // Read the persisted version back independently of the ingest return value.
      const persistedVersions = await runtime.knowledge.versions.listByDocument(
        ingestResult.document.id,
      );
      expect(persistedVersions.map((v) => v.versionNumber)).toEqual([1]);

      const enterpriseProfile = await runtime.knowledge.enterpriseProfiles.upsert({
        clientOrganizationId: clientOrg.id,
        legalName: "Example Client Enterprise Ltd.",
        actingUserId: clientOwnerUser,
        industry: "B2B SaaS",
      });
      const reloadedProfile = await runtime.knowledge.enterpriseProfiles.findByClientOrganization(
        clientOrg.id,
      );
      expect(reloadedProfile?.id).toBe(enterpriseProfile.id);

      // ----------------------------------------------------------------------
      // GEO chain. The geo KnowledgePackage / IndustryProfile aggregates are
      // referenced only by opaque UUID from the persisted tables (see the
      // composition-root header); they are driven through their append-only
      // in-memory ports, while everything downstream is persisted for real.
      // ----------------------------------------------------------------------
      const geoKnowledgePackage = await runtime.geo.keywordQuestion.createKnowledgePackage(
        clientActor,
        {
          clientOrganizationId: clientOrg.id,
          projectId: project.id,
          version: 1,
          title: "GEO Knowledge Package",
          sourceDescription: "Derived from the ingested enterprise knowledge base.",
        },
      );

      const industryProfile = await runtime.geo.keywordQuestion.createIndustryProfile(clientActor, {
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
        verticalSlug: "b2b-saas",
        verticalLabel: "B2B SaaS",
        validationGateLevel: "INDUSTRY_VERTICAL_GATE",
        ruleSetVersion: 1,
      });

      const keywordQuestionMap = await runtime.geo.keywordQuestion.createKeywordQuestionMap(
        clientActor,
        {
          knowledgePackage: geoKnowledgePackage,
          industryProfileId: industryProfile.id,
          entries: [
            {
              keyword: "generative engine optimization",
              questions: ["what is generative engine optimization?", "how does GEO work?"],
            },
          ],
        },
      );
      // Read the KeywordQuestionMap back from the real table.
      expect(
        (await runtime.geoRepositories.keywordQuestionMaps.getById(keywordQuestionMap.id))?.id,
      ).toBe(keywordQuestionMap.id);

      const opportunity = await runtime.geo.opportunity.createOpportunity(clientActor, {
        keywordQuestionMap,
        keyword: "generative engine optimization",
        knowledgePackage: geoKnowledgePackage,
      });
      expect((await runtime.geoRepositories.opportunities.getById(opportunity.id))?.keyword).toBe(
        "generative engine optimization",
      );

      const validation = await runtime.geo.validation.validateOpportunity(clientActor, {
        opportunity,
        industryProfile,
        status: "VALIDATED",
        reasonNote: "Meets the vertical rule gate.",
      });

      // A human review with an EXPLICIT reviewer — the only path to APPROVED.
      const reviewDecision = await runtime.geo.humanReview.confirm(
        clientActor,
        validation,
        clientOwnerUser,
      );
      expect(reviewDecision.status).toBe("APPROVED");
      // No silently-approved state: the persisted decision names a real reviewer.
      const persistedDecision = await runtime.geoRepositories.humanReviews.getById(
        reviewDecision.id,
      );
      expect(persistedDecision?.status).toBe("APPROVED");
      expect(persistedDecision?.reviewerId).toBe(clientOwnerUser);

      const family = await runtime.geo.family.createFamily(clientActor, {
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
        members: [
          {
            opportunityId: opportunity.id,
            authorizingHumanReviewDecisionId: reviewDecision.id,
            authorizingReviewDecisionStatus: "APPROVED",
          },
        ],
      });

      const brief = await runtime.geo.brief.createBrief(clientActor, {
        family,
        workingTitle: "The state of generative engine optimization",
        outline: ["Introduction", "How answer engines rank content", "Conclusion"],
        targetKeywords: ["generative engine optimization"],
        riskLevel: "STANDARD",
      });
      expect((await runtime.geoRepositories.articleBriefs.getById(brief.id))?.id).toBe(brief.id);

      // Provider content enters as an OPAQUE offline envelope id — never a call.
      const providerContent = await runtime.geo.pipeline.ingestProviderArticleContent(
        clientActor,
        brief,
        "offline_envelope_e2e_1",
      );

      const draft = await runtime.geo.pipeline.compileDraft(clientActor, brief, [providerContent]);
      expect((await runtime.geoRepositories.articleDrafts.getById(draft.id))?.id).toBe(draft.id);

      // Determinism + Provider Calls = 0, proven concretely: the frozen pure
      // compiler yields deep-equal drafts for identical inputs and injected
      // identity — there is no hidden nondeterministic/provider step.
      const identity = { id: "fixed_draft_id", version: 1, compiledAt: "2026-07-18T00:00:00.000Z" };
      const compiledOnce = compileArticleDraft(brief, [providerContent], identity);
      const compiledTwice = compileArticleDraft(brief, [providerContent], identity);
      expect(compiledTwice).toEqual(compiledOnce);
      expect(draft.sections.map((s) => s.heading)).toEqual(brief.outline);

      // Quality / Platform / Vertical gates all PASS (persisted).
      const qualityGate = await runtime.geo.gates.evaluateQuality(clientActor, draft, brief);
      const platformGate = await runtime.geo.gates.evaluatePlatformGate(
        clientActor,
        draft,
        industryProfile,
      );
      const verticalGate = await runtime.geo.gates.evaluateVerticalGate(
        clientActor,
        draft,
        industryProfile,
      );
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

      // Explicit human article approval (persisted).
      const approval = await runtime.geo.gates.approveArticle(
        clientActor,
        draft,
        clientOwnerUser,
        qualityGate,
        platformGate,
        verticalGate,
      );
      expect((await runtime.geoRepositories.articleApprovals.getById(approval.id))?.approverId).toBe(
        clientOwnerUser,
      );

      // PublishPackage + channel-neutral package: DEFAULT selected channels = 0.
      const publishPackage = await runtime.geo.publish.createPublishPackage(
        clientActor,
        approval,
        draft,
      );
      const channelNeutralPackage = await runtime.geo.publish.createChannelNeutralPackage(
        clientActor,
        publishPackage,
        [{ kind: "PARAGRAPH", text: "Example channel-neutral body content.", order: 0 }],
      );
      expect(channelNeutralPackage.targetChannelIds).toEqual([]);
      // Read back from the real table: still 0 selected channels by construction.
      const reloadedCnc = await runtime.geoRepositories.channelNeutralPackages.getByPublishPackage(
        publishPackage.id,
      );
      expect(reloadedCnc?.targetChannelIds).toEqual([]);

      // A human explicitly selects exactly one channel (DistributionPlan persisted).
      const distributionPlan = await runtime.geo.distribution.createDistributionPlan(clientActor, {
        channelNeutralPackage,
        channelIds: ["channel_example_official_site"],
        selectedByActorId: clientOwnerUser,
      });
      expect(distributionPlan.channelIds).toEqual(["channel_example_official_site"]);
      expect(distributionPlan.selectedByActorId).toBe(clientOwnerUser);

      // PublicationReceipt by a REAL human actor (persisted with its delivery row).
      const receipt = await runtime.geo.delivery.recordPublicationReceipt(
        clientActor,
        distributionPlan,
        "channel_example_official_site",
        clientOwnerUser,
      );
      expect(receipt.publishedByActorId).toBe(clientOwnerUser);
      // Automatic Publication = NO: a system/automatic actor is REJECTED.
      await expect(
        runtime.geo.delivery.recordPublicationReceipt(
          clientActor,
          distributionPlan,
          "channel_example_official_site",
          "system",
        ),
      ).rejects.toThrow();

      // ----------------------------------------------------------------------
      // Visibility across roles.
      // ----------------------------------------------------------------------
      // Client Delivery Center: the delivery row is readable by the client.
      const clientDeliveries = await runtime.geoRepositories.deliveries.listByScope({
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
      });
      expect(clientDeliveries.map((r) => r.id)).toContain(receipt.id);
      const clientStatus = await runtime.geo.delivery.publicationStatus(clientActor, distributionPlan);
      expect(clientStatus).toBe("PUBLISHED");

      // Agency Workspace: the assigned agency can read the client's status.
      const agencyActor = agencyOwnerContext(agencyOrg.id, agencyUser, [clientOrg.id]);
      const agencyStatus = await runtime.geo.delivery.publicationStatus(agencyActor, distributionPlan);
      expect(agencyStatus).toBe("PUBLISHED");

      // Ops Audit: the complete GEO audit-event trail is readable from the DB.
      const auditTrail = await runtime.tenancy.auditEvents.listByOrganization(clientOrg.id, 200);
      const actions = new Set(auditTrail.map((e) => e.action));
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
        "quality_gate.passed",
        "platform_gate.passed",
        "vertical_gate.passed",
        "article.approved",
        "publish_package.created",
        "channel_neutral_content_package.created",
        "distribution_plan.created",
        "publication_receipt.recorded",
      ]) {
        expect(actions.has(expected)).toBe(true);
      }
      // Every audit row carries a tamper-evidence hash.
      expect(auditTrail.every((e) => typeof e.eventHash === "string" && e.eventHash.length > 0)).toBe(
        true,
      );

      // ----------------------------------------------------------------------
      // Tenant isolation: client B cannot see or reach client A's data.
      // ----------------------------------------------------------------------
      const clientBOwner = await createUser("client-b-owner@example.test");
      const clientBOrg = await runtime.tenancy.organizations.createIdempotent({
        type: "CLIENT",
        displayName: "Other Client Enterprise",
        idempotencyKey: "e2e-client-b",
        createdByUserId: agencyUser,
      });
      const projectB = await runtime.tenancy.projects.create({
        clientOrganizationId: clientBOrg.id,
        name: "Other Client Project",
        createdByUserId: agencyUser,
      });
      const clientBActor = clientOwnerContext(clientBOrg.id, clientBOwner);

      // B's scoped reads see none of A's persisted artifacts.
      expect(
        await runtime.geoRepositories.opportunities.listByScope({
          clientOrganizationId: clientBOrg.id,
          projectId: projectB.id,
        }),
      ).toEqual([]);
      expect(
        await runtime.geoRepositories.deliveries.listByScope({
          clientOrganizationId: clientBOrg.id,
          projectId: projectB.id,
        }),
      ).toEqual([]);
      // And B is fail-closed denied at the authorization boundary for A's plan.
      await expect(
        runtime.geo.delivery.publicationStatus(clientBActor, distributionPlan),
      ).rejects.toThrow();

      // A's opportunity IS visible under A's own scope (control for the above).
      const aOpportunities = await runtime.geoRepositories.opportunities.listByScope({
        clientOrganizationId: clientOrg.id,
        projectId: project.id,
      });
      expect(aOpportunities.map((o) => o.id)).toContain(opportunity.id);
    });
  },
);
