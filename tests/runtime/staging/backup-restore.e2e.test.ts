/**
 * STAGING_OPERATIONS_V1 batch 2 (Agent E2) — real backup + restore-to-fresh + data-survival E2E.
 *
 * Proves, against a real PostgreSQL, that the ops backup/restore CLIs work end to end and that
 * seeded data survives a full dump/restore cycle:
 *
 *   1. create a THROWAWAY source database (geoplane_bkp_src_<suffix>) owned by the superuser,
 *   2. applyMigrations 0001-0006 on it,
 *   3. seed a handful of rows across the tenancy + knowledge + geo chains
 *      (user / organization / project / knowledge_package / knowledge_content /
 *       opportunity / delivery / audit_event, plus the FK rows the delivery chain requires),
 *   4. run scripts/backup/backup.mjs to pg_dump it to a custom-format archive,
 *   5. run scripts/backup/restore.mjs to CREATE a fresh target database and pg_restore into it,
 *   6. connect to the TARGET and assert every seeded row — including the knowledge_content TEXT —
 *      is present and identical, and that the append-only triggers were restored too,
 *   7. drop BOTH throwaway databases.
 *
 * The throwaway databases are created/dropped via the superuser role ('postgres'), whose password
 * is shared with the .env connection (ENV FACT). When no test database is configured the whole
 * suite skips cleanly, exactly like the sibling *.pg suites. Every throwaway name is unique per
 * run, so this never collides with the shared GEO_TEST_DATABASE_URL database.
 *
 * Provider calls = 0: this suite touches only Postgres and the local backup/restore CLIs.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort, DbQueryResult } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";

const testConfig = loadDatabaseConfig({ test: true });
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const migrationsDir = join(repoRoot, "migrations");
const backupScript = join(repoRoot, "scripts", "backup", "backup.mjs");
const restoreScript = join(repoRoot, "scripts", "backup", "restore.mjs");

const SUPERUSER = "postgres";
const HOOK_TIMEOUT = 120_000;

/** Rebuild the base connection string with a different role and database (password preserved). */
function withUserAndDb(baseUrl: string, user: string, database: string): string {
  const u = new URL(baseUrl);
  u.username = user;
  u.pathname = `/${database}`;
  return u.toString();
}

function one<T>(res: DbQueryResult<T>): T {
  const row = res.rows[0];
  if (!row) throw new Error("expected exactly one row, got none");
  return row;
}

const uniqueSuffix = `${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const SRC_DB = `geoplane_bkp_src_${uniqueSuffix}`;
const DST_DB = `geoplane_bkp_dst_${uniqueSuffix}`;

/** The seed values we later assert survived the round-trip. */
const seed = {
  userId: randomUUID(),
  email: `pilot+${uniqueSuffix}@example.test`,
  orgId: randomUUID(),
  orgName: "Acme Pilot Client",
  projectId: randomUUID(),
  projectName: "Pilot Project Alpha",
  kpId: randomUUID(),
  kpTitle: "Pilot Knowledge Package",
  opportunityId: randomUUID(),
  keyword: "generative engine optimization",
  deliveryId: randomUUID(),
  auditId: randomUUID(),
  storagePath: "",
  contentText:
    "Durable pilot content.\nLine two with unicode · 世界 · ✓\nThis exact text must survive backup + restore.",
  contentHash: "",
};
seed.storagePath = `knowledge/${seed.kpId}/doc-1/pilot`;
seed.contentHash = createHash("sha256").update(seed.contentText, "utf8").digest("hex");

/** Seed the full FK chain (through `delivery`) plus the assertable rows into the source database. */
async function seedSource(db: DatabasePort): Promise<void> {
  await db.query(`INSERT INTO "user"(id, email) VALUES ($1, $2)`, [seed.userId, seed.email]);

  await db.query(
    `INSERT INTO organization(id, type, display_name, idempotency_key, created_by_user_id)
     VALUES ($1, 'CLIENT', $2, $3, $4)`,
    [seed.orgId, seed.orgName, `idem-${seed.orgId}`, seed.userId],
  );

  await db.query(
    `INSERT INTO project(id, client_organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3, $4)`,
    [seed.projectId, seed.orgId, seed.projectName, seed.userId],
  );

  await db.query(
    `INSERT INTO knowledge_package(id, client_organization_id, project_id, title, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [seed.kpId, seed.orgId, seed.projectId, seed.kpTitle, seed.userId],
  );

  // knowledge_content — the durable extracted TEXT that must survive verbatim.
  await db.query(
    `INSERT INTO knowledge_content(storage_path, content_hash, content_text, client_organization_id, project_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [seed.storagePath, seed.contentHash, seed.contentText, seed.orgId, seed.projectId],
  );

  const kqmId = randomUUID();
  await db.query(
    `INSERT INTO keyword_question_map(id, client_organization_id, project_id,
        knowledge_package_id, knowledge_package_version, industry_profile_id)
     VALUES ($1, $2, $3, $4, 1, $5)`,
    [kqmId, seed.orgId, seed.projectId, seed.kpId, randomUUID()],
  );

  await db.query(
    `INSERT INTO opportunity(id, client_organization_id, project_id, keyword_question_map_id,
        keyword, grounding_knowledge_package_id, grounding_knowledge_package_version)
     VALUES ($1, $2, $3, $4, $5, $6, 1)`,
    [seed.opportunityId, seed.orgId, seed.projectId, kqmId, seed.keyword, seed.kpId],
  );

  // --- delivery chain (opportunity_family -> ... -> delivery) --------------------------------
  const familyId = randomUUID();
  await db.query(
    `INSERT INTO opportunity_family(id, client_organization_id, project_id) VALUES ($1, $2, $3)`,
    [familyId, seed.orgId, seed.projectId],
  );

  const briefId = randomUUID();
  const hrdId = randomUUID();
  await db.query(
    `INSERT INTO article_brief(id, client_organization_id, project_id, opportunity_family_id,
        working_title, planning_schema_version, planning_opportunity_family_id, planning_risk_level,
        planning_target_keywords, planning_authorizing_hrd_ids)
     VALUES ($1, $2, $3, $4, $5, 'ArticleBriefPlanningContextV1', $4, 'STANDARD',
        ARRAY['geo']::text[], ARRAY['${hrdId}']::uuid[])`,
    [briefId, seed.orgId, seed.projectId, familyId, "The State of GEO"],
  );

  const draftId = randomUUID();
  const sourceContentId = randomUUID();
  await db.query(
    `INSERT INTO article_draft(id, client_organization_id, project_id, article_brief_id, version,
        title, section_headings, source_provider_article_content_ids, status, sealed_at, compiled_at)
     VALUES ($1, $2, $3, $4, 1, $5, ARRAY['Intro']::text[], ARRAY['${sourceContentId}']::uuid[],
        'SEALED', now(), now())`,
    [draftId, seed.orgId, seed.projectId, briefId, "The State of GEO"],
  );

  const qgId = randomUUID();
  await db.query(
    `INSERT INTO quality_gate_result(id, client_organization_id, project_id, article_draft_id, status, evaluated_at)
     VALUES ($1, $2, $3, $4, 'PASSED', now())`,
    [qgId, seed.orgId, seed.projectId, draftId],
  );

  const pgId = randomUUID();
  await db.query(
    `INSERT INTO platform_gate_result(id, client_organization_id, project_id, article_draft_id,
        gate_kind, industry_profile_id, gate_level_applied, status, evaluated_at)
     VALUES ($1, $2, $3, $4, 'PLATFORM_GATE', $5, 'PLATFORM_WIDE_GATE', 'PASSED', now())`,
    [pgId, seed.orgId, seed.projectId, draftId, randomUUID()],
  );

  const vgId = randomUUID();
  await db.query(
    `INSERT INTO vertical_gate_result(id, client_organization_id, project_id, article_draft_id,
        gate_kind, industry_profile_id, gate_level_applied, status, evaluated_at)
     VALUES ($1, $2, $3, $4, 'VERTICAL_GATE', $5, 'INDUSTRY_VERTICAL_GATE', 'PASSED', now())`,
    [vgId, seed.orgId, seed.projectId, draftId, randomUUID()],
  );

  const approvalId = randomUUID();
  await db.query(
    `INSERT INTO article_approval(id, client_organization_id, project_id, article_draft_id,
        approver_user_id, approved_at, quality_gate_id, quality_gate_status,
        platform_gate_id, platform_gate_status, vertical_gate_id, vertical_gate_status)
     VALUES ($1, $2, $3, $4, $5, now(), $6, 'PASSED', $7, 'PASSED', $8, 'PASSED')`,
    [approvalId, seed.orgId, seed.projectId, draftId, seed.userId, qgId, pgId, vgId],
  );

  const publishId = randomUUID();
  await db.query(
    `INSERT INTO publish_package(id, client_organization_id, project_id, article_approval_id,
        article_draft_id, title, built_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [publishId, seed.orgId, seed.projectId, approvalId, draftId, "The State of GEO"],
  );

  const cncId = randomUUID();
  await db.query(
    `INSERT INTO channel_neutral_content_package(id, client_organization_id, project_id, publish_package_id)
     VALUES ($1, $2, $3, $4)`,
    [cncId, seed.orgId, seed.projectId, publishId],
  );

  const planId = randomUUID();
  await db.query(
    `INSERT INTO distribution_plan(id, client_organization_id, project_id,
        channel_neutral_content_package_id, channel_ids, selected_by_actor_id, selected_at)
     VALUES ($1, $2, $3, $4, ARRAY['web']::text[], $5, now())`,
    [planId, seed.orgId, seed.projectId, cncId, "user_pilot_operator"],
  );

  const receiptId = randomUUID();
  await db.query(
    `INSERT INTO publication_receipt(id, client_organization_id, project_id, distribution_plan_id,
        channel_id, published_by_actor_id, published_at)
     VALUES ($1, $2, $3, $4, 'web', $5, now())`,
    [receiptId, seed.orgId, seed.projectId, planId, "user_pilot_operator"],
  );

  await db.query(
    `INSERT INTO delivery(id, client_organization_id, project_id, distribution_plan_id,
        publication_receipt_id, channel_id, delivered_at)
     VALUES ($1, $2, $3, $4, $5, 'web', now())`,
    [seed.deliveryId, seed.orgId, seed.projectId, planId, receiptId],
  );

  // audit_event — with JSONB metadata that must round-trip.
  await db.query(
    `INSERT INTO audit_event(id, organization_id, actor_user_id, actor_organization_id,
        action, target_type, target_id, metadata, event_hash)
     VALUES ($1, $2, $3, $2, $4, 'delivery', $5, $6::jsonb, $7)`,
    [
      seed.auditId,
      seed.orgId,
      seed.userId,
      "pilot.backup.seed",
      seed.deliveryId,
      JSON.stringify({ source: "backup-e2e", ok: true }),
      `evhash-${seed.auditId}`,
    ],
  );
}

let adminDb: DatabasePort;
let targetDb: DatabasePort;
let backupDir: string;

describe.skipIf(testConfig === null)("STAGING_OPERATIONS_V1 batch 2 — backup + restore-to-fresh E2E", () => {
  beforeAll(async () => {
    const baseUrl = testConfig!.connectionString;
    backupDir = mkdtempSync(join(tmpdir(), "geoplane-bkp-e2e-"));

    // Superuser connection to the maintenance db for create/drop of the throwaway databases.
    adminDb = createPgDatabase({ connectionString: withUserAndDb(baseUrl, SUPERUSER, "postgres"), max: 2 });

    // Clean slate, then a fresh source database.
    await adminDb.query(`DROP DATABASE IF EXISTS "${SRC_DB}" WITH (FORCE)`);
    await adminDb.query(`DROP DATABASE IF EXISTS "${DST_DB}" WITH (FORCE)`);
    await adminDb.query(`CREATE DATABASE "${SRC_DB}"`);

    // Migrate + seed the source (as the superuser that owns it).
    const srcDb = createPgDatabase({ connectionString: withUserAndDb(baseUrl, SUPERUSER, SRC_DB), max: 4 });
    try {
      await applyMigrations(srcDb, migrationsDir);
      await seedSource(srcDb);
    } finally {
      await srcDb.close();
    }

    // (4) Dump the source via the real backup CLI.
    const backupOut = execFileSync(
      process.execPath,
      [backupScript, "--test", "--db", SRC_DB, "--user", SUPERUSER, "--out", backupDir],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const artifactLine = backupOut.split(/\r?\n/).find((l) => l.startsWith("ARTIFACT "));
    if (!artifactLine) throw new Error(`backup.mjs did not report an ARTIFACT path:\n${backupOut}`);
    const dumpFile = artifactLine.slice("ARTIFACT ".length).trim();

    // (5) Restore into a FRESH target via the real restore CLI (it creates the database).
    execFileSync(
      process.execPath,
      [restoreScript, "--test", "--db", DST_DB, "--user", SUPERUSER, "--dump", dumpFile],
      { cwd: repoRoot, encoding: "utf8" },
    );

    // Connect to the TARGET for the assertions below.
    targetDb = createPgDatabase({ connectionString: withUserAndDb(baseUrl, SUPERUSER, DST_DB), max: 4 });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (targetDb) await targetDb.close();
    if (adminDb) {
      await adminDb.query(`DROP DATABASE IF EXISTS "${SRC_DB}" WITH (FORCE)`).catch(() => {});
      await adminDb.query(`DROP DATABASE IF EXISTS "${DST_DB}" WITH (FORCE)`).catch(() => {});
      await adminDb.close();
    }
    if (backupDir) rmSync(backupDir, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  it("restored the full schema into the fresh target (tables + append-only triggers)", async () => {
    const tables = one(
      await targetDb.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      ),
    );
    // 0001-0006 create well over a dozen tables; the exact number is not the point — non-trivial is.
    expect(tables.n).toBeGreaterThan(15);

    const triggers = one(
      await targetDb.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.triggers WHERE trigger_schema = 'public'`,
      ),
    );
    expect(triggers.n).toBeGreaterThan(0);
  });

  it("preserved the tenancy rows: user / organization / project", async () => {
    const user = one(await targetDb.query<{ email: string }>(`SELECT email FROM "user" WHERE id = $1`, [seed.userId]));
    expect(user.email).toBe(seed.email);

    const org = one(
      await targetDb.query<{ display_name: string; type: string }>(
        `SELECT display_name, type FROM organization WHERE id = $1`,
        [seed.orgId],
      ),
    );
    expect(org.display_name).toBe(seed.orgName);
    expect(org.type).toBe("CLIENT");

    const project = one(await targetDb.query<{ name: string }>(`SELECT name FROM project WHERE id = $1`, [seed.projectId]));
    expect(project.name).toBe(seed.projectName);
  });

  it("preserved the knowledge_package and the durable knowledge_content TEXT verbatim", async () => {
    const kp = one(await targetDb.query<{ title: string }>(`SELECT title FROM knowledge_package WHERE id = $1`, [seed.kpId]));
    expect(kp.title).toBe(seed.kpTitle);

    const content = one(
      await targetDb.query<{ content_text: string; content_hash: string; project_id: string | null }>(
        `SELECT content_text, content_hash, project_id FROM knowledge_content WHERE storage_path = $1`,
        [seed.storagePath],
      ),
    );
    // The whole point of migration 0006: the extracted text survives, byte-for-byte.
    expect(content.content_text).toBe(seed.contentText);
    expect(content.content_hash).toBe(seed.contentHash);
    expect(content.project_id).toBe(seed.projectId);
  });

  it("preserved the opportunity row", async () => {
    const opp = one(
      await targetDb.query<{ keyword: string; project_id: string }>(
        `SELECT keyword, project_id FROM opportunity WHERE id = $1`,
        [seed.opportunityId],
      ),
    );
    expect(opp.keyword).toBe(seed.keyword);
    expect(opp.project_id).toBe(seed.projectId);
  });

  it("preserved the delivery row and its append-only immutability", async () => {
    const delivery = one(
      await targetDb.query<{ channel_id: string; client_readable: boolean; publication_receipt_id: string }>(
        `SELECT channel_id, client_readable, publication_receipt_id FROM delivery WHERE id = $1`,
        [seed.deliveryId],
      ),
    );
    expect(delivery.channel_id).toBe("web");
    expect(delivery.client_readable).toBe(true);

    // The restored append-only trigger is live in the target too.
    await expect(
      targetDb.query(`UPDATE delivery SET client_readable = false WHERE id = $1`, [seed.deliveryId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("preserved the audit_event row including its JSONB metadata", async () => {
    const audit = one(
      await targetDb.query<{ action: string; target_id: string; metadata: { source?: string; ok?: boolean } }>(
        `SELECT action, target_id, metadata FROM audit_event WHERE id = $1`,
        [seed.auditId],
      ),
    );
    expect(audit.action).toBe("pilot.backup.seed");
    expect(audit.target_id).toBe(seed.deliveryId);
    expect(audit.metadata.source).toBe("backup-e2e");
    expect(audit.metadata.ok).toBe(true);
  });

  it("backup.mjs refuses to dump a production-named database", () => {
    let threw = false;
    let combined = "";
    try {
      execFileSync(
        process.execPath,
        [backupScript, "--test", "--db", "geoplane_production_canary", "--user", SUPERUSER, "--out", backupDir],
        { cwd: repoRoot, encoding: "utf8", stdio: "pipe" },
      );
    } catch (err) {
      threw = true;
      const e = err as { stdout?: string; stderr?: string };
      combined = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(threw).toBe(true);
    expect(combined).toMatch(/production\/recovery pattern/i);
  });
});
