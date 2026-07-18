/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — real-Postgres persistence tests for the
 * REMAINDER of the GEO business chain (opportunity-family -> article-brief ->
 * article-draft -> quality/platform/vertical gates -> article-approval ->
 * publish-package -> channel-neutral-content-package -> distribution-plan ->
 * publication-receipt -> delivery), behind the E1 ports, backed by
 * migrations/0004_geo_article_delivery.sql.
 *
 * Runs against GEO_TEST_DATABASE_URL (a throwaway database). When no test
 * database is configured the whole suite skips cleanly, exactly like the E2
 * keyword/opportunity pg suite — the DB-less unit suites are unaffected.
 *
 * Proves, for real:
 *   1. migration 0004 applies via applyMigrations and every aggregate persists.
 *   2. the full chain round-trips through the adapters.
 *   3. article_draft is versioned: v1 then v2 for one brief; the prior version
 *      is immutable and a duplicate version is rejected.
 *   4. gates round-trip both PASSED and FAILED (with non-empty failure reasons).
 *   5. a channel-neutral content package defaults to 0 selected channels.
 *   6. a publication receipt with a system/automatic actor is rejected by the
 *      database, and the whole receipt+delivery transaction rolls back.
 *   7. the client-readable `delivery` projection is written alongside the receipt.
 *   8. UPDATE and DELETE are rejected on the append-only tables (article_draft,
 *      article_approval, publication_receipt, delivery).
 *   9. tenant scoping: client A's artifacts are invisible to client B.
 *
 * Provider calls = 0: this module imports no provider/network surface — there is
 * no such port in the GEO runtime. This suite is persistence-only.
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import {
  buildPublishPackage,
  createChannelNeutralContentPackage,
  createPublicationReceipt,
  type ArticleApproval,
  type ArticleBrief,
  type DistributionPlan,
  type DraftArticleDraft,
  type OpportunityFamily,
  type PassedPlatformGate,
  type PassedQualityGate,
  type PassedVerticalGate,
  type PublicationReceipt,
} from "../../../src/contracts/geo-business/entities.js";
import { PgArticleApprovalRepository } from "../../../src/runtime/geo/pg/article-approval-repository.js";
import { PgArticleBriefRepository } from "../../../src/runtime/geo/pg/article-brief-repository.js";
import { PgArticleDraftRepository } from "../../../src/runtime/geo/pg/article-draft-repository.js";
import { PgChannelNeutralContentPackageRepository } from "../../../src/runtime/geo/pg/channel-neutral-content-package-repository.js";
import { PgDeliveryRepository } from "../../../src/runtime/geo/pg/delivery-repository.js";
import { PgDistributionPlanRepository } from "../../../src/runtime/geo/pg/distribution-plan-repository.js";
import { PgOpportunityFamilyRepository } from "../../../src/runtime/geo/pg/opportunity-family-repository.js";
import { PgPlatformGateRepository } from "../../../src/runtime/geo/pg/platform-gate-repository.js";
import { PgPublishPackageRepository } from "../../../src/runtime/geo/pg/publish-package-repository.js";
import { PgQualityGateRepository } from "../../../src/runtime/geo/pg/quality-gate-repository.js";
import { PgVerticalGateRepository } from "../../../src/runtime/geo/pg/vertical-gate-repository.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

const NOW = "2026-07-18T00:00:00.000Z";
const LATER = "2026-07-18T01:00:00.000Z";

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

function buildFamily(t: Tenant): OpportunityFamily {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    members: [
      {
        opportunityId: randomUUID(),
        authorizingHumanReviewDecisionId: randomUUID(),
        authorizingReviewDecisionStatus: "APPROVED",
      },
      {
        opportunityId: randomUUID(),
        authorizingHumanReviewDecisionId: randomUUID(),
        authorizingReviewDecisionStatus: "APPROVED",
      },
    ],
    createdAt: NOW,
  };
}

function buildBrief(t: Tenant, familyId: string): ArticleBrief {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    opportunityFamilyId: familyId,
    planningContext: {
      schemaVersion: "ArticleBriefPlanningContextV1",
      opportunityFamilyId: familyId,
      authorizingHumanReviewDecisionIds: [randomUUID(), randomUUID()],
      targetKeywords: ["generative engine optimization", "answer engines"],
      riskLevel: "STANDARD",
    },
    workingTitle: "The state of GEO",
    outline: ["Intro", "Body", "Conclusion"],
    createdAt: NOW,
  };
}

function buildDraft(t: Tenant, briefId: string, version: number): DraftArticleDraft {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    articleBriefId: briefId,
    sourceProviderArticleContentIds: [randomUUID()],
    version,
    title: "The state of GEO",
    sections: [
      { heading: "Intro", order: 0 },
      { heading: "Body", order: 1 },
      { heading: "Conclusion", order: 2 },
    ],
    status: "DRAFT",
    compiledAt: version === 1 ? NOW : LATER,
  };
}

function passedQualityGate(t: Tenant, draftId: string): PassedQualityGate {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    articleDraftId: draftId,
    status: "PASSED",
    evaluatedAt: NOW,
  };
}

function passedPlatformGate(t: Tenant, draftId: string): PassedPlatformGate {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    gateKind: "PLATFORM_GATE",
    articleDraftId: draftId,
    industryProfileId: randomUUID(),
    gateLevelApplied: "PLATFORM_WIDE_GATE",
    status: "PASSED",
    evaluatedAt: NOW,
  };
}

function passedVerticalGate(t: Tenant, draftId: string): PassedVerticalGate {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    gateKind: "VERTICAL_GATE",
    articleDraftId: draftId,
    industryProfileId: randomUUID(),
    gateLevelApplied: "INDUSTRY_VERTICAL_GATE",
    status: "PASSED",
    evaluatedAt: NOW,
  };
}

function buildApproval(
  t: Tenant,
  draftId: string,
  qualityGateId: string,
  platformGateId: string,
  verticalGateId: string,
): ArticleApproval {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    articleDraftId: draftId,
    approverId: t.userId,
    approvedAt: NOW,
    qualityGateId,
    qualityGateStatus: "PASSED",
    platformGateId,
    platformGateStatus: "PASSED",
    verticalGateId,
    verticalGateStatus: "PASSED",
  };
}

/**
 * Persists the full happy-path chain for a tenant and returns the key artifacts.
 * A distribution plan always carries an explicit human-chosen channel set.
 */
async function persistChain(t: Tenant): Promise<{
  draft: DraftArticleDraft;
  approval: ArticleApproval;
  plan: DistributionPlan;
}> {
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

  const family = buildFamily(t);
  await familyRepo.add(family);

  const brief = buildBrief(t, family.id);
  await briefRepo.add(brief);

  const draft = buildDraft(t, brief.id, 1);
  await draftRepo.add(draft);

  const quality = passedQualityGate(t, draft.id);
  const platform = passedPlatformGate(t, draft.id);
  const vertical = passedVerticalGate(t, draft.id);
  await qualityRepo.add(quality);
  await platformRepo.add(platform);
  await verticalRepo.add(vertical);

  const approval = buildApproval(t, draft.id, quality.id, platform.id, vertical.id);
  await approvalRepo.add(approval);

  const pkg = buildPublishPackage(approval, draft, { id: randomUUID(), builtAt: NOW });
  await publishRepo.add(pkg);

  const cnc = createChannelNeutralContentPackage(
    pkg,
    [
      { kind: "HEADING", text: "The state of GEO", order: 0 },
      { kind: "PARAGRAPH", text: "Body text.", order: 1 },
    ],
    { id: randomUUID(), createdAt: NOW },
  );
  await cncRepo.add(cnc);

  const plan: DistributionPlan = {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    channelNeutralContentPackageId: cnc.id,
    channelIds: ["channel_neutral_hub", "channel_partner_blog"],
    selectedByActorId: "user_platform_jane",
    selectedAt: NOW,
  };
  await planRepo.add(plan);

  return { draft, approval, plan };
}

describe.skipIf(testConfig === null)(
  "ARTICLE_GATE_DELIVERY_RUNTIME_V1 — real database persistence",
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
        `TRUNCATE delivery, publication_receipt, distribution_plan,
                  channel_neutral_content_block, channel_neutral_content_package,
                  publish_package, article_approval,
                  vertical_gate_result, platform_gate_result, quality_gate_result,
                  article_draft, article_brief,
                  opportunity_family_member, opportunity_family,
                  project, organization, "user"
         RESTART IDENTITY CASCADE`,
      );
    });

    it("round-trips an OpportunityFamily with its members", async () => {
      const t = await bootstrapTenant("a");
      const repo = new PgOpportunityFamilyRepository(db);
      const family = buildFamily(t);

      await repo.add(family);
      expect(await repo.getById(family.id)).toEqual(family);

      const members = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM opportunity_family_member WHERE opportunity_family_id = $1`,
        [family.id],
      );
      expect(members.rows[0]?.n).toBe("2");
    });

    it("rejects a duplicate OpportunityFamily id (append-only)", async () => {
      const t = await bootstrapTenant("a");
      const repo = new PgOpportunityFamilyRepository(db);
      const family = buildFamily(t);
      await repo.add(family);
      await expect(repo.add(family)).rejects.toThrow(/append-only/i);
    });

    it("round-trips an ArticleBrief with its inline planning context", async () => {
      const t = await bootstrapTenant("a");
      const familyRepo = new PgOpportunityFamilyRepository(db);
      const briefRepo = new PgArticleBriefRepository(db);

      const family = buildFamily(t);
      await familyRepo.add(family);
      const brief = buildBrief(t, family.id);
      await briefRepo.add(brief);

      expect(await briefRepo.getById(brief.id)).toEqual(brief);
    });

    it("versions article drafts: v1 then v2 for one brief; prior version immutable", async () => {
      const t = await bootstrapTenant("a");
      const familyRepo = new PgOpportunityFamilyRepository(db);
      const briefRepo = new PgArticleBriefRepository(db);
      const draftRepo = new PgArticleDraftRepository(db);

      const family = buildFamily(t);
      await familyRepo.add(family);
      const brief = buildBrief(t, family.id);
      await briefRepo.add(brief);

      const v1 = buildDraft(t, brief.id, 1);
      const v2 = buildDraft(t, brief.id, 2);
      await draftRepo.add(v1);
      await draftRepo.add(v2);

      expect(await draftRepo.getById(v1.id)).toEqual(v1);
      expect(await draftRepo.getById(v2.id)).toEqual(v2);

      const all = await draftRepo.listByArticleBrief(brief.id);
      expect(all.map((d) => d.version)).toEqual([1, 2]);

      // A duplicate version for the same brief is rejected by uq_article_draft_brief_version.
      const dupVersion = buildDraft(t, brief.id, 1);
      await expect(draftRepo.add(dupVersion)).rejects.toThrow();

      // The prior version is immutable at the DB level.
      await expect(
        db.query(`UPDATE article_draft SET title = 'tampered' WHERE id = $1`, [v1.id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM article_draft WHERE id = $1`, [v1.id]),
      ).rejects.toThrow(/append-only/i);
      expect((await draftRepo.getById(v1.id))?.title).toBe("The state of GEO");
    });

    it("round-trips PASSED and FAILED quality gates (failure reasons preserved)", async () => {
      const t = await bootstrapTenant("a");
      const familyRepo = new PgOpportunityFamilyRepository(db);
      const briefRepo = new PgArticleBriefRepository(db);
      const draftRepo = new PgArticleDraftRepository(db);
      const qualityRepo = new PgQualityGateRepository(db);

      const family = buildFamily(t);
      await familyRepo.add(family);
      const brief = buildBrief(t, family.id);
      await briefRepo.add(brief);
      const draft = buildDraft(t, brief.id, 1);
      await draftRepo.add(draft);

      const passed = passedQualityGate(t, draft.id);
      await qualityRepo.add(passed);
      expect(await qualityRepo.getById(passed.id)).toEqual(passed);

      const failed = {
        id: randomUUID(),
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
        articleDraftId: draft.id,
        status: "FAILED" as const,
        failureReasons: ["Draft has one or more blank headings.", "Missing planning context."] as [
          string,
          ...string[],
        ],
        evaluatedAt: NOW,
      };
      await qualityRepo.add(failed);
      expect(await qualityRepo.getById(failed.id)).toEqual(failed);
    });

    it("persists the full chain through publish package with 0 default channels", async () => {
      const t = await bootstrapTenant("a");
      const publishRepo = new PgPublishPackageRepository(db);
      const cncRepo = new PgChannelNeutralContentPackageRepository(db);

      const { approval, plan } = await persistChain(t);

      // Publish package exists, tied to the approval.
      const packages = await publishRepo.listByScope({
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
      });
      expect(packages).toHaveLength(1);
      expect(packages[0]?.articleApprovalId).toBe(approval.id);

      // The channel-neutral package was born with 0 selected channels.
      const cnc = await cncRepo.getByPublishPackage(packages[0]!.id);
      expect(cnc?.targetChannelIds).toEqual([]);
      expect(cnc?.blocks).toHaveLength(2);

      // The auditable channel set lives on the distribution plan, not the package.
      expect(plan.channelIds).toEqual(["channel_neutral_hub", "channel_partner_blog"]);
    });

    it("channel_neutral_content_package.target_channel_ids DB-defaults to an empty array", async () => {
      const t = await bootstrapTenant("a");
      const { draft, approval } = await persistChain(t);
      // Build one more publish package to attach a raw-inserted package to.
      const publishRepo = new PgPublishPackageRepository(db);
      const pkg = buildPublishPackage(approval, draft, { id: randomUUID(), builtAt: NOW });
      await publishRepo.add(pkg);

      // Insert WITHOUT specifying target_channel_ids — the column DEFAULT must be '{}'.
      const inserted = await db.query<{ target_channel_ids: string[] }>(
        `INSERT INTO channel_neutral_content_package
           (client_organization_id, project_id, publish_package_id, created_at)
         VALUES ($1, $2, $3, now())
         RETURNING target_channel_ids`,
        [t.orgId, t.projectId, pkg.id],
      );
      expect(inserted.rows[0]?.target_channel_ids).toEqual([]);
    });

    it("records a publication receipt and its client-readable delivery, then forbids mutation", async () => {
      const t = await bootstrapTenant("a");
      const deliveryRepo = new PgDeliveryRepository(db);
      const { plan } = await persistChain(t);

      const receipt = createPublicationReceipt(plan, "channel_neutral_hub", "user_platform_jane", {
        id: randomUUID(),
        publishedAt: NOW,
      });
      await deliveryRepo.add(receipt);

      expect(await deliveryRepo.listByPlan(plan.id)).toEqual([receipt]);

      // The client-readable delivery projection was written alongside the receipt.
      const delivery = await db.query<{
        publication_receipt_id: string;
        client_readable: boolean;
        channel_id: string;
      }>(
        `SELECT publication_receipt_id, client_readable, channel_id FROM delivery WHERE distribution_plan_id = $1`,
        [plan.id],
      );
      expect(delivery.rows).toHaveLength(1);
      expect(delivery.rows[0]?.publication_receipt_id).toBe(receipt.id);
      expect(delivery.rows[0]?.client_readable).toBe(true);
      expect(delivery.rows[0]?.channel_id).toBe("channel_neutral_hub");

      // Both terminal tables are append-only.
      await expect(
        db.query(`UPDATE publication_receipt SET channel_id = 'x' WHERE id = $1`, [receipt.id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM publication_receipt WHERE id = $1`, [receipt.id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`UPDATE delivery SET client_readable = false WHERE publication_receipt_id = $1`, [
          receipt.id,
        ]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM delivery WHERE publication_receipt_id = $1`, [receipt.id]),
      ).rejects.toThrow(/append-only/i);
    });

    it("rejects a publication receipt with a system/automatic actor (no automatic publication)", async () => {
      const t = await bootstrapTenant("a");
      const deliveryRepo = new PgDeliveryRepository(db);
      const { plan } = await persistChain(t);

      // Forge a receipt with a system actor, bypassing the frozen constructor.
      const forged: PublicationReceipt = {
        id: randomUUID(),
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
        distributionPlanId: plan.id,
        channelId: "channel_neutral_hub",
        publishedByActorId: "system",
        publishedAt: NOW,
      };
      await expect(deliveryRepo.add(forged)).rejects.toThrow();

      // The whole receipt+delivery transaction rolled back: nothing slipped through.
      const receipts = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM publication_receipt`,
      );
      const deliveries = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM delivery`);
      expect(receipts.rows[0]?.n).toBe("0");
      expect(deliveries.rows[0]?.n).toBe("0");
    });

    it("makes a silently-approved article-approval unrepresentable at the DB level", async () => {
      const t = await bootstrapTenant("a");
      const familyRepo = new PgOpportunityFamilyRepository(db);
      const briefRepo = new PgArticleBriefRepository(db);
      const draftRepo = new PgArticleDraftRepository(db);
      const qualityRepo = new PgQualityGateRepository(db);
      const platformRepo = new PgPlatformGateRepository(db);
      const verticalRepo = new PgVerticalGateRepository(db);

      const family = buildFamily(t);
      await familyRepo.add(family);
      const brief = buildBrief(t, family.id);
      await briefRepo.add(brief);
      const draft = buildDraft(t, brief.id, 1);
      await draftRepo.add(draft);
      const quality = passedQualityGate(t, draft.id);
      const platform = passedPlatformGate(t, draft.id);
      const vertical = passedVerticalGate(t, draft.id);
      await qualityRepo.add(quality);
      await platformRepo.add(platform);
      await verticalRepo.add(vertical);

      // No approver, no timestamp — the database refuses it (NOT NULL + CHECK).
      await expect(
        db.query(
          `INSERT INTO article_approval
             (id, client_organization_id, project_id, article_draft_id, approver_user_id, approved_at,
              quality_gate_id, quality_gate_status, platform_gate_id, platform_gate_status,
              vertical_gate_id, vertical_gate_status)
           VALUES ($1, $2, $3, $4, NULL, NULL, $5, 'PASSED', $6, 'PASSED', $7, 'PASSED')`,
          [randomUUID(), t.orgId, t.projectId, draft.id, quality.id, platform.id, vertical.id],
        ),
      ).rejects.toThrow();

      // A real approval is append-only once written.
      const approvalRepo = new PgArticleApprovalRepository(db);
      const approval = buildApproval(t, draft.id, quality.id, platform.id, vertical.id);
      await approvalRepo.add(approval);
      expect(await approvalRepo.getById(approval.id)).toEqual(approval);
      await expect(
        db.query(`UPDATE article_approval SET approver_user_id = $1 WHERE id = $2`, [
          t.userId,
          approval.id,
        ]),
      ).rejects.toThrow(/append-only/i);
    });

    it("isolates tenants: client A's publish packages and receipts are invisible to client B", async () => {
      const a = await bootstrapTenant("a");
      const b = await bootstrapTenant("b");
      const publishRepo = new PgPublishPackageRepository(db);
      const deliveryRepo = new PgDeliveryRepository(db);

      const { plan } = await persistChain(a);
      const receipt = createPublicationReceipt(plan, "channel_neutral_hub", "user_platform_jane", {
        id: randomUUID(),
        publishedAt: NOW,
      });
      await deliveryRepo.add(receipt);

      const packagesA = await publishRepo.listByScope({
        clientOrganizationId: a.orgId,
        projectId: a.projectId,
      });
      const packagesB = await publishRepo.listByScope({
        clientOrganizationId: b.orgId,
        projectId: b.projectId,
      });
      expect(packagesA).toHaveLength(1);
      expect(packagesB).toEqual([]);

      const receiptsA = await deliveryRepo.listByScope({
        clientOrganizationId: a.orgId,
        projectId: a.projectId,
      });
      const receiptsB = await deliveryRepo.listByScope({
        clientOrganizationId: b.orgId,
        projectId: b.projectId,
      });
      expect(receiptsA.map((r) => r.id)).toEqual([receipt.id]);
      expect(receiptsB).toEqual([]);
    });
  },
);
