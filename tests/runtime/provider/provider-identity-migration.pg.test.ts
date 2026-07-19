/**
 * PROVIDER_IDENTITY_LEDGER_V1 — migration 0008 backfill + fresh-database tests.
 *
 * Runs against GEO_TEST_DATABASE_URL (a throwaway database). When no test
 * database is configured the whole suite skips cleanly, exactly like the other
 * `*.pg.test.ts` suites.
 *
 * Proves, for real (not by inspection):
 *   1. LEGACY BACKFILL — a `provider_execution` row written under the 0007
 *      schema (before the identity columns existed) is backfilled BY DDL when
 *      0008 applies: gateway_vendor 'UNKNOWN_LEGACY', model_vendor 'DEEPSEEK',
 *      protocol 'OPENAI_COMPATIBLE' — while the append-only UPDATE/DELETE
 *      triggers stay armed the whole time (the backfill is ADD COLUMN ... NOT
 *      NULL DEFAULT, never a row UPDATE, so it cannot trip them).
 *   2. PgProviderLedger reads a backfilled row back as a valid
 *      ProviderIdentity with gatewayVendor 'UNKNOWN_LEGACY'.
 *   3. FRESH DATABASE — scripts/db/migrate.mjs (the real CLI, spawned) applies
 *      the complete current migration manifest cleanly against GEO_TEST_DATABASE_URL from an
 *      empty schema, including migrations that follow the 0008 identity migration.
 *
 * The staged (0001→0007, insert, then →0008) replay uses byte-identical copies
 * of the migration files in a scratch directory, so the checksum ledger accepts
 * the later full-directory run as already-applied for 0001–0007.
 *
 * This suite REBUILDS the schema (DROP SCHEMA public CASCADE) — safe because
 * vitest.config.ts serializes test files and every other pg suite re-applies
 * migrations in its own beforeAll. The suite leaves the database fully migrated.
 *
 * ZERO REAL NETWORK; no secret is read, printed, or persisted.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { PgProviderLedger } from "../../../src/runtime/provider/pg-provider-ledger.js";

const testConfig = loadDatabaseConfig({ test: true });
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationsDir = join(repoRoot, "migrations");

/** The migration prefix through 0008; 0008 is the identity migration under test. */
const IDENTITY_MIGRATIONS = [
  "0001_tenancy_foundation.sql",
  "0002_knowledge_runtime.sql",
  "0003_geo_runtime.sql",
  "0004_geo_article_delivery.sql",
  "0005_runtime_continuity.sql",
  "0006_knowledge_content.sql",
  "0007_provider_ledger.sql",
  "0008_provider_identity.sql",
] as const;
const CURRENT_MIGRATIONS = [
  ...IDENTITY_MIGRATIONS,
  "0009_password_credentials.sql",
  "0010_domestic_account_center.sql",
  "0011_baidu_keyword_runtime.sql",
  "0012_ai_keyword_expansion.sql",
  "0013_china_ai_probe_runtime.sql",
  "0014_vertical_policy_pack.sql",
  "0015_agency_delivery_runtime.sql",
] as const;

let db: DatabasePort;

/** Nuke and recreate the public schema of the throwaway test database. */
async function resetSchema(): Promise<void> {
  await db.query("DROP SCHEMA public CASCADE");
  await db.query("CREATE SCHEMA public");
}

async function seedProject(): Promise<{ projectId: string; orgId: string }> {
  const u = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [`identity-migration+${randomUUID()}@example.test`],
  );
  const userId = u.rows[0]!.id;
  const org = await db.query<{ id: string }>(
    `INSERT INTO organization (type, display_name, idempotency_key, created_by_user_id)
     VALUES ('CLIENT', $1, $2, $3) RETURNING id`,
    [`identity-org-${randomUUID()}`, `identity-org-${randomUUID()}`, userId],
  );
  const orgId = org.rows[0]!.id;
  const proj = await db.query<{ id: string }>(
    `INSERT INTO project (client_organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [orgId, "identity migration test project", userId],
  );
  return { projectId: proj.rows[0]!.id, orgId };
}

describe.skipIf(testConfig === null)(
  "PROVIDER_IDENTITY_LEDGER_V1 — migration 0008 backfill + fresh database",
  () => {
    beforeAll(() => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 4 });
    });

    afterAll(async () => {
      if (db) {
        // Leave the shared test database fully migrated for the next suite.
        await resetSchema();
        await applyMigrations(db, migrationsDir);
        await db.close();
      }
    });

    it(
      "backfills pre-0008 rows via DDL default (UNKNOWN_LEGACY / DEEPSEEK / OPENAI_COMPATIBLE) " +
        "without tripping the append-only triggers",
      async () => {
        // Stage 1: an empty schema migrated only through 0007 (byte-identical
        // copies, so the checksum ledger later accepts them as already applied).
        const stagedDir = mkdtempSync(join(tmpdir(), "geo-mig-0007-"));
        try {
          for (const f of IDENTITY_MIGRATIONS.slice(0, -1)) {
            copyFileSync(join(migrationsDir, f), join(stagedDir, f));
          }
          await resetSchema();
          const first = await applyMigrations(db, stagedDir);
          expect(first.applied).toHaveLength(IDENTITY_MIGRATIONS.length - 1);

          // Stage 2: a LEGACY row, written under the 0007 shape (no identity columns).
          const { projectId, orgId } = await seedProject();
          const legacyKey = `idem_legacy_${randomUUID()}`;
          await db.query(
            `INSERT INTO provider_execution
               (request_id, idempotency_key, project_id, client_organization_id, article_brief_id,
                model, status, error_code, prompt_tokens, completion_tokens, total_tokens, latency_ms)
             VALUES ($1, $2, $3, $4, $5, 'deepseek-v4-flash', 'OK', NULL, 152, 490, 642, 5901)`,
            [`req_legacy_${randomUUID()}`, legacyKey, projectId, orgId, randomUUID()],
          );

          // Stage 3: apply the full directory — provider identity plus subsequent migrations are new.
          const second = await applyMigrations(db, migrationsDir);
          expect(second.applied).toEqual([
            "0008_provider_identity.sql",
            "0009_password_credentials.sql",
            "0010_domestic_account_center.sql",
            "0011_baidu_keyword_runtime.sql",
            "0012_ai_keyword_expansion.sql",
            "0013_china_ai_probe_runtime.sql",
            "0014_vertical_policy_pack.sql",
            "0015_agency_delivery_runtime.sql",
          ]);
          expect(second.skipped).toHaveLength(IDENTITY_MIGRATIONS.length - 1);

          // The legacy row was backfilled by the DDL default (a row UPDATE would
          // have raised the append-only trigger and aborted the migration).
          const legacy = await db.query<{
            gateway_vendor: string;
            model_vendor: string;
            protocol: string;
            model: string;
            total_tokens: number | null;
          }>(`SELECT * FROM provider_execution WHERE idempotency_key = $1`, [legacyKey]);
          expect(legacy.rows).toHaveLength(1);
          expect(legacy.rows[0]!.gateway_vendor).toBe("UNKNOWN_LEGACY");
          expect(legacy.rows[0]!.model_vendor).toBe("DEEPSEEK");
          expect(legacy.rows[0]!.protocol).toBe("OPENAI_COMPATIBLE");
          // The rest of the historical row is untouched.
          expect(legacy.rows[0]!.model).toBe("deepseek-v4-flash");
          expect(legacy.rows[0]!.total_tokens).toBe(642);

          // The triggers are still armed after 0008.
          await expect(
            db.query(
              `UPDATE provider_execution SET gateway_vendor = 'ALIYUN_MAAS' WHERE idempotency_key = $1`,
              [legacyKey],
            ),
          ).rejects.toThrow(/append-only/i);
          await expect(
            db.query(`DELETE FROM provider_execution WHERE idempotency_key = $1`, [legacyKey]),
          ).rejects.toThrow(/append-only/i);

          // The ledger reads the backfilled row back as a valid identity.
          const ledger = new PgProviderLedger(db);
          const entry = await ledger.getByIdempotencyKey(legacyKey);
          expect(entry?.identity).toEqual({
            gatewayVendor: "UNKNOWN_LEGACY",
            modelVendor: "DEEPSEEK",
            protocol: "OPENAI_COMPATIBLE",
          });
        } finally {
          rmSync(stagedDir, { recursive: true, force: true });
        }
      },
      120_000,
    );

    it(
      "fresh database: scripts/db/migrate.mjs applies the current manifest cleanly against GEO_TEST_DATABASE_URL",
      async () => {
        await resetSchema();

        // The REAL CLI, spawned as an operator would run it. It resolves
        // GEO_TEST_DATABASE_URL itself (env / .env.local); nothing secret is
        // passed on the command line or printed by this test.
        const res = spawnSync(process.execPath, [join(repoRoot, "scripts", "db", "migrate.mjs"), "--test"], {
          cwd: repoRoot,
          encoding: "utf8",
        });
        expect(res.status).toBe(0);
        for (const f of CURRENT_MIGRATIONS) {
          expect(res.stdout).toContain(`apply  ${f}`);
        }

        // Every current file is recorded, and the identity columns exist with their CHECKs.
        const ledgerRows = await db.query<{ filename: string }>(
          `SELECT filename FROM schema_migrations ORDER BY filename`,
        );
        expect(ledgerRows.rows.map((r) => r.filename)).toEqual([...CURRENT_MIGRATIONS]);

        const cols = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
          `SELECT column_name, is_nullable, column_default FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'provider_execution'
             AND column_name IN ('gateway_vendor', 'model_vendor', 'protocol')
           ORDER BY column_name`,
        );
        expect(cols.rows.map((r) => r.column_name)).toEqual([
          "gateway_vendor",
          "model_vendor",
          "protocol",
        ]);
        for (const row of cols.rows) {
          expect(row.is_nullable).toBe("NO");
          // The backfill DEFAULT is dropped on a fresh database too.
          expect(row.column_default).toBeNull();
        }

        const checks = await db.query<{ conname: string }>(
          `SELECT conname FROM pg_constraint
           WHERE conrelid = 'provider_execution'::regclass AND contype = 'c'
             AND conname IN (
               'ck_provider_execution_gateway_vendor',
               'ck_provider_execution_model_vendor',
               'ck_provider_execution_protocol'
             )
           ORDER BY conname`,
        );
        expect(checks.rows.map((r) => r.conname)).toEqual([
          "ck_provider_execution_gateway_vendor",
          "ck_provider_execution_model_vendor",
          "ck_provider_execution_protocol",
        ]);
      },
      120_000,
    );
  },
);
