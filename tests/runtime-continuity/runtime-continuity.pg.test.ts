/**
 * RUNTIME_DATA_CONTINUITY_V1 (Agent B) — real-Postgres persistence tests for the
 * three GEO ports that previously used append-only IN-MEMORY adapters in the
 * composition root. Backed by migrations/0005_runtime_continuity.sql plus the
 * EXISTING knowledge_package table (migration 0002).
 *
 * Runs against GEO_TEST_DATABASE_URL (a throwaway database, geoplane_pc_b). When
 * no test database is configured the whole suite skips cleanly, exactly like the
 * other *.pg.test.ts suites — the DB-less unit suites are unaffected.
 *
 * Proves, for real:
 *   1. migration 0005 applies via applyMigrations; both new tables exist; the
 *      append-only trigger on provider_article_content rejects UPDATE/DELETE.
 *   2. industry_profile: add/read round-trip, duplicate-id rejection, one
 *      canonical profile per project, and canonical re-classification via upsert.
 *   3. provider_article_content: append assigns monotonic per-brief versions,
 *      listByArticleBrief round-trips, duplicate-id rejection.
 *   4. the KnowledgePackage BRIDGE reads back a package created through the
 *      knowledge repos — the same canonical row — proving a SINGLE SOURCE OF
 *      TRUTH (no duplicate copy), including reflecting a later CONFIRM as SEALED.
 *   5. RESTART CONTINUITY at the persistence level: rows written through one
 *      createPgDatabase pool are read back through a NEW pool after the first is
 *      closed.
 *
 * Provider calls = 0: this module imports no provider/network surface — there is
 * no such port in the GEO runtime. Persistence-only.
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import type {
  IndustryProfile,
  KnowledgePackage,
  ProviderArticleContent,
} from "../../src/contracts/geo-business/entities.js";
import { PgKnowledgePackageRepository } from "../../src/runtime/knowledge/pg/package-repository.js";
import { KnowledgePackageBridge } from "../../src/persistence/runtime-continuity/knowledge-package-bridge.js";
import { PgIndustryProfileRepository } from "../../src/persistence/runtime-continuity/industry-profile-repository.js";
import { PgProviderArticleContentRepository } from "../../src/persistence/runtime-continuity/provider-article-content-repository.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

const NOW = "2026-07-18T00:00:00.000Z";
const LATER = "2026-07-18T02:30:00.000Z";

let db: DatabasePort;

// ---------------------------------------------------------------------------
// Tenancy bootstrap (parameterized by a connection so the restart test can use
// its own pool).
// ---------------------------------------------------------------------------

interface Tenant {
  readonly orgId: string;
  readonly projectId: string;
  readonly userId: string;
}

async function createUser(conn: DatabasePort, email: string): Promise<string> {
  const res = await conn.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createClientOrg(conn: DatabasePort, key: string, userId: string): Promise<string> {
  const res = await conn.query<{ id: string }>(
    `INSERT INTO organization (type, display_name, idempotency_key, created_by_user_id)
     VALUES ('CLIENT', $1, $2, $3) RETURNING id`,
    [key, key, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("organization insert returned no row");
  return row.id;
}

async function createProject(
  conn: DatabasePort,
  clientOrgId: string,
  userId: string,
  name: string,
): Promise<string> {
  const res = await conn.query<{ id: string }>(
    `INSERT INTO project (client_organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [clientOrgId, name, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("project insert returned no row");
  return row.id;
}

async function bootstrapTenant(conn: DatabasePort, key: string): Promise<Tenant> {
  const userId = await createUser(conn, `${key}-${randomUUID()}@example.test`);
  const orgId = await createClientOrg(conn, `client-${key}-${randomUUID()}`, userId);
  const projectId = await createProject(conn, orgId, userId, `Project ${key}`);
  return { orgId, projectId, userId };
}

function buildProfile(t: Tenant, overrides: Partial<IndustryProfile> = {}): IndustryProfile {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    verticalSlug: "healthcare",
    verticalLabel: "Healthcare & Life Sciences",
    validationGateLevel: "INDUSTRY_VERTICAL_GATE",
    ruleSetVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildContent(
  t: Tenant,
  articleBriefId: string,
  overrides: Partial<ProviderArticleContent> = {},
): ProviderArticleContent {
  return {
    id: randomUUID(),
    clientOrganizationId: t.orgId,
    projectId: t.projectId,
    articleBriefId,
    providerResponseEnvelopeId: `envelope-${randomUUID()}`,
    receivedAt: NOW,
    ...overrides,
  };
}

async function truncateAll(conn: DatabasePort): Promise<void> {
  await conn.query(
    `TRUNCATE provider_article_content, industry_profile, knowledge_package,
              project, organization, "user"
     RESTART IDENTITY CASCADE`,
  );
}

describe.skipIf(testConfig === null)(
  "RUNTIME_DATA_CONTINUITY_V1 — real database persistence",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
    });

    afterAll(async () => {
      if (db) await db.close();
    });

    beforeEach(async () => {
      await truncateAll(db);
    });

    // -----------------------------------------------------------------------
    // 1. Migration 0005
    // -----------------------------------------------------------------------

    it("applies migration 0005 and creates both new tables", async () => {
      const ledger = await db.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations WHERE filename = $1`,
        ["0005_runtime_continuity.sql"],
      );
      expect(ledger.rows[0]?.filename).toBe("0005_runtime_continuity.sql");

      // Both tables exist and are queryable (empty after truncate).
      const ip = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM industry_profile`);
      const pac = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM provider_article_content`,
      );
      expect(ip.rows[0]?.n).toBe("0");
      expect(pac.rows[0]?.n).toBe("0");
    });

    it("forbids UPDATE and DELETE on the append-only provider_article_content table", async () => {
      const t = await bootstrapTenant(db, "trg");
      const repo = new PgProviderArticleContentRepository(db);
      const content = buildContent(t, randomUUID());
      await repo.add(content);

      await expect(
        db.query(
          `UPDATE provider_article_content SET provider_response_envelope_id = 'x' WHERE id = $1`,
          [content.id],
        ),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM provider_article_content WHERE id = $1`, [content.id]),
      ).rejects.toThrow(/append-only/i);

      // Untouched.
      const still = await repo.listByArticleBrief(content.articleBriefId);
      expect(still).toHaveLength(1);
    });

    // -----------------------------------------------------------------------
    // 2. IndustryProfile
    // -----------------------------------------------------------------------

    it("adds and reads back an IndustryProfile (round-trip)", async () => {
      const t = await bootstrapTenant(db, "ip-rt");
      const repo = new PgIndustryProfileRepository(db);
      const profile = buildProfile(t);

      const added = await repo.add(profile);
      expect(added).toEqual(profile);
      const fetched = await repo.getById(profile.id);
      expect(fetched).toEqual(profile);
    });

    it("rejects a duplicate IndustryProfile id (append-only)", async () => {
      const a = await bootstrapTenant(db, "ip-dup-a");
      const b = await bootstrapTenant(db, "ip-dup-b");
      const repo = new PgIndustryProfileRepository(db);

      const sharedId = randomUUID();
      await repo.add(buildProfile(a, { id: sharedId }));
      // Same id, different tenant -> only the primary key collides.
      await expect(repo.add(buildProfile(b, { id: sharedId }))).rejects.toThrow(/append-only/i);
    });

    it("enforces one canonical IndustryProfile per project", async () => {
      const t = await bootstrapTenant(db, "ip-canon");
      const repo = new PgIndustryProfileRepository(db);
      await repo.add(buildProfile(t));

      // A second, different-id profile for the SAME project is rejected.
      await expect(repo.add(buildProfile(t))).rejects.toThrow(/one canonical/i);
    });

    it("re-classifies the canonical IndustryProfile in place via upsert", async () => {
      const t = await bootstrapTenant(db, "ip-upsert");
      const repo = new PgIndustryProfileRepository(db);
      const profile = buildProfile(t, { verticalLabel: "Healthcare", ruleSetVersion: 1 });
      await repo.add(profile);

      const updated = await repo.upsert(
        buildProfile(t, {
          id: profile.id,
          verticalLabel: "Healthcare & Life Sciences (re-classified)",
          ruleSetVersion: 2,
          createdAt: profile.createdAt,
          updatedAt: LATER,
        }),
      );

      // Same canonical row (id + created_at preserved), classification bumped.
      expect(updated.id).toBe(profile.id);
      expect(updated.createdAt).toBe(NOW);
      expect(updated.verticalLabel).toBe("Healthcare & Life Sciences (re-classified)");
      expect(updated.ruleSetVersion).toBe(2);
      expect(updated.updatedAt).toBe(LATER);

      const fetched = await repo.getById(profile.id);
      expect(fetched).toEqual(updated);

      // Still exactly one canonical profile for the project.
      const count = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM industry_profile WHERE project_id = $1`,
        [t.projectId],
      );
      expect(count.rows[0]?.n).toBe("1");
    });

    // -----------------------------------------------------------------------
    // 3. ProviderArticleContent
    // -----------------------------------------------------------------------

    it("appends provider content and assigns monotonic per-brief versions", async () => {
      const t = await bootstrapTenant(db, "pac-ver");
      const repo = new PgProviderArticleContentRepository(db);
      const briefId = randomUUID();

      const c1 = buildContent(t, briefId);
      const c2 = buildContent(t, briefId);
      await repo.add(c1);
      await repo.add(c2);

      // Round-trips as the append-ordered contract entities (no version field).
      const list = await repo.listByArticleBrief(briefId);
      expect(list).toEqual([c1, c2]);

      // Persistence-level version is monotonic per brief: 1, 2.
      const versions = await db.query<{ id: string; version: number }>(
        `SELECT id, version FROM provider_article_content WHERE article_brief_id = $1 ORDER BY version`,
        [briefId],
      );
      expect(versions.rows.map((r) => r.version)).toEqual([1, 2]);

      // A different brief starts its own version sequence at 1.
      const otherBrief = randomUUID();
      const c3 = buildContent(t, otherBrief);
      await repo.add(c3);
      const otherVersion = await db.query<{ version: number }>(
        `SELECT version FROM provider_article_content WHERE id = $1`,
        [c3.id],
      );
      expect(otherVersion.rows[0]?.version).toBe(1);
    });

    it("rejects a duplicate ProviderArticleContent id (append-only)", async () => {
      const t = await bootstrapTenant(db, "pac-dup");
      const repo = new PgProviderArticleContentRepository(db);
      const content = buildContent(t, randomUUID());
      await repo.add(content);
      await expect(repo.add(content)).rejects.toThrow(/append-only/i);
    });

    // -----------------------------------------------------------------------
    // 4. KnowledgePackage bridge — single source of truth
    // -----------------------------------------------------------------------

    it("bridge reads back a KnowledgePackage created through the knowledge repos (single source of truth)", async () => {
      const t = await bootstrapTenant(db, "kp-ssot");
      const knowledgeRepo = new PgKnowledgePackageRepository(db);
      const bridge = new KnowledgePackageBridge(db);

      // Created via the OWNING knowledge runtime (defaults: DRAFT / INTERNAL).
      const created = await knowledgeRepo.create({
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
        title: "Acme enterprise knowledge base",
        createdByUserId: t.userId,
      });

      // The geo bridge projects the SAME canonical row into the geo-business shape.
      const viaBridge = await bridge.getById(created.id);
      expect(viaBridge?.id).toBe(created.id);
      expect(viaBridge?.title).toBe("Acme enterprise knowledge base");
      expect(viaBridge?.status).toBe("DRAFT");
      expect(viaBridge?.version).toBe(1);
      expect(viaBridge?.createdAt).toBe(created.createdAt);
      expect(viaBridge?.sourceDescription).toContain("INTERNAL");

      const listed = await bridge.listByScope({
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
      });
      expect(listed.map((p) => p.id)).toEqual([created.id]);

      // There is exactly ONE physical row — no duplicate copy of enterprise knowledge.
      const rowCount = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM knowledge_package`,
      );
      expect(rowCount.rows[0]?.n).toBe("1");

      // Confirming the package through the knowledge runtime is reflected by the
      // bridge as SEALED — it reads the live canonical state, not a stale copy.
      await knowledgeRepo.confirm(created.id, t.userId);
      const sealed = await bridge.getById(created.id);
      expect(sealed?.status).toBe("SEALED");
      if (sealed?.status === "SEALED") {
        expect(typeof sealed.sealedAt).toBe("string");
        expect(sealed.sealedAt.length).toBeGreaterThan(0);
      }
    });

    it("bridge.add writes into the canonical knowledge_package and rejects duplicates", async () => {
      const t = await bootstrapTenant(db, "kp-add");
      const bridge = new KnowledgePackageBridge(db, { createdByUserId: t.userId });
      const kp: KnowledgePackage = {
        id: randomUUID(),
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
        version: 1,
        title: "Geo-originated package",
        sourceDescription: "will be re-derived on read",
        status: "DRAFT",
        createdAt: NOW,
      };

      const added = await bridge.add(kp);
      expect(added.id).toBe(kp.id);
      expect(added.status).toBe("DRAFT");

      // It landed in the single canonical table, readable by the knowledge repo.
      const viaKnowledge = await new PgKnowledgePackageRepository(db).findById(kp.id);
      expect(viaKnowledge?.id).toBe(kp.id);
      expect(viaKnowledge?.title).toBe("Geo-originated package");

      // Append-only: a duplicate id is rejected.
      await expect(bridge.add(kp)).rejects.toThrow(/append-only/i);
    });

    it("bridge.add without a service principal refuses to fabricate provenance", async () => {
      const t = await bootstrapTenant(db, "kp-noprincipal");
      const bridge = new KnowledgePackageBridge(db);
      const kp: KnowledgePackage = {
        id: randomUUID(),
        clientOrganizationId: t.orgId,
        projectId: t.projectId,
        version: 1,
        title: "Should not persist",
        sourceDescription: "n/a",
        status: "DRAFT",
        createdAt: NOW,
      };
      await expect(bridge.add(kp)).rejects.toThrow(/service-principal|single source of truth/i);

      // Nothing was written.
      const count = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM knowledge_package`);
      expect(count.rows[0]?.n).toBe("0");
    });

    // -----------------------------------------------------------------------
    // 5. Restart continuity (persistence level): a fresh pool reads it all back
    // -----------------------------------------------------------------------

    it("persists all three aggregates across a fresh connection pool (restart continuity)", async () => {
      // Ensure a clean slate, then work entirely through independent pools.
      await truncateAll(db);

      const pool1 = createPgDatabase({ connectionString: testConfig!.connectionString, max: 4 });
      let profileId: string;
      let contentId: string;
      let articleBriefId: string;
      let knowledgePackageId: string;
      let tenant: Tenant;
      try {
        tenant = await bootstrapTenant(pool1, "restart");
        articleBriefId = randomUUID();

        const profile = buildProfile(tenant);
        profileId = profile.id;
        await new PgIndustryProfileRepository(pool1).add(profile);

        const content = buildContent(tenant, articleBriefId);
        contentId = content.id;
        await new PgProviderArticleContentRepository(pool1).add(content);

        const created = await new PgKnowledgePackageRepository(pool1).create({
          clientOrganizationId: tenant.orgId,
          projectId: tenant.projectId,
          title: "Survives the restart",
          createdByUserId: tenant.userId,
        });
        knowledgePackageId = created.id;
      } finally {
        // Close the ORIGINAL pool — simulating the process that wrote the data
        // going away entirely.
        await pool1.close();
      }

      // A brand-new pool (fresh connections) reads the same rows back.
      const pool2 = createPgDatabase({ connectionString: testConfig!.connectionString, max: 4 });
      try {
        const profile = await new PgIndustryProfileRepository(pool2).getById(profileId);
        expect(profile?.id).toBe(profileId);
        expect(profile?.verticalSlug).toBe("healthcare");

        const contents = await new PgProviderArticleContentRepository(pool2).listByArticleBrief(
          articleBriefId,
        );
        expect(contents.map((c) => c.id)).toEqual([contentId]);

        const kp = await new KnowledgePackageBridge(pool2).getById(knowledgePackageId);
        expect(kp?.id).toBe(knowledgePackageId);
        expect(kp?.title).toBe("Survives the restart");
        expect(kp?.status).toBe("DRAFT");
      } finally {
        await pool2.close();
      }
    });
  },
);
