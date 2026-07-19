/**
 * LOCAL_RECOVERY_DRILL_V1 — real local PostgreSQL recovery exercise.
 *
 * A dedicated, allowlisted source database is created; the runtime and pool are restarted without
 * truncating any shared runtime database; routine session-key rotation is exercised through the
 * real login route; then the local-only drill performs pg_dump + independent SHA-256 verification
 * + restore into the fixed geoplane_local_restore_verify database. Provider code is never invoked,
 * and the provider ledger remains empty in both source and restored databases.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgApplicationRuntime } from "../../src/composition/pg-application-runtime.js";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import { POST as loginRoute } from "../../src/app/api/auth/login/route.js";
import {
  createAuthRuntime,
  __setAuthRuntimeForTests,
  type AuthRuntime,
} from "../../src/runtime/auth/runtime-context.js";
import { __setSessionSigningKeysForTests } from "../../src/lib/session-signing.js";
import {
  TEST_LOGIN_PASSWORD,
  TEST_LOGIN_PASSWORD_HASH,
} from "../helpers/auth-credentials.js";

const testConfig = loadDatabaseConfig({ test: true });
const repoRoot = join(import.meta.dirname, "..", "..");
const migrationsDir = join(repoRoot, "migrations");
const drillScript = join(repoRoot, "scripts", "recovery", "local-recovery-drill.mjs");
const SUPERUSER = process.env.GEO_PG_SUPERUSER?.trim() || "postgres";
const suffix = `${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const SOURCE_DB = `geoplane_local_drill_source_${suffix}`;
const TARGET_DB = "geoplane_local_restore_verify";
const EMAIL = `local-recovery-${suffix}@example.test`;
const K1 = "local-recovery-routine-key-one-test-only-0000000001";
const K2 = "local-recovery-routine-key-two-test-only-0000000002";
const HOOK_TIMEOUT = 180_000;

let admin: DatabasePort;
let sourceCreated = false;
let targetCreatedByTest = false;
let outputDir: string | null = null;
let userId = "";
let organizationId = "";
let projectId = "";
let cookieK1 = "";

function withUserAndDb(baseUrl: string, user: string, database: string): string {
  const url = new URL(baseUrl);
  url.username = user;
  url.pathname = `/${database}`;
  return url.toString();
}

async function loginAndGetCookie(email: string): Promise<string> {
  const response = await loginRoute(
    new Request("http://local.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_LOGIN_PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login route did not issue a session cookie");
  return cookie;
}

describe.skipIf(testConfig === null)("LOCAL_RECOVERY_DRILL_V1 — local PostgreSQL E2E", () => {
  beforeAll(async () => {
    const baseUrl = testConfig!.connectionString;
    const parsed = new URL(baseUrl);
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname.toLowerCase())) {
      throw new Error("LOCAL_RECOVERY_DRILL_V1 refuses a non-loopback GEO_TEST_DATABASE_URL");
    }

    admin = createPgDatabase({
      connectionString: withUserAndDb(baseUrl, SUPERUSER, "postgres"),
      max: 2,
    });
    const targetExists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [TARGET_DB]);
    if ((targetExists.rowCount ?? 0) > 0) {
      throw new Error(
        `${TARGET_DB} already exists; refusing to replace operator recovery evidence. Remove it explicitly before this E2E.`,
      );
    }
    await admin.query(`CREATE DATABASE "${SOURCE_DB}"`);
    sourceCreated = true;

    const sourceUrl = withUserAndDb(baseUrl, SUPERUSER, SOURCE_DB);
    const db1 = createPgDatabase({ connectionString: sourceUrl, max: 4 });
    const runtime1 = createPgApplicationRuntime(db1);
    const auth1: AuthRuntime = createAuthRuntime(db1);
    __setAuthRuntimeForTests(auth1);
    __setSessionSigningKeysForTests({ current: K1, previous: null });
    try {
      await applyMigrations(db1, migrationsDir);
      const user = await db1.query<{ id: string }>(
        `INSERT INTO "user" (email, password_hash) VALUES ($1, $2) RETURNING id`,
        [EMAIL, TEST_LOGIN_PASSWORD_HASH],
      );
      userId = user.rows[0]?.id ?? "";
      if (!userId) throw new Error("local drill user insert returned no id");
      const organization = await runtime1.tenancy.organizations.createIdempotent({
        type: "CLIENT",
        displayName: "Local Recovery Drill Client (Desensitized)",
        idempotencyKey: `local-recovery-${suffix}`,
        createdByUserId: userId,
      });
      organizationId = organization.id;
      await runtime1.tenancy.memberships.create({
        userId,
        organizationId,
        role: "CLIENT_OWNER",
      });
      const project = await runtime1.tenancy.projects.create({
        clientOrganizationId: organizationId,
        name: "Local Recovery Drill Project (Desensitized)",
        createdByUserId: userId,
      });
      projectId = project.id;
      cookieK1 = await loginAndGetCookie(EMAIL);
      expect((await auth1.resolveSession(cookieK1))?.userId).toBe(userId);

      const ledger = await db1.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM provider_execution`,
      );
      expect(ledger.rows[0]?.n).toBe(0);
    } finally {
      __setAuthRuntimeForTests(null);
      await db1.close();
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    __setSessionSigningKeysForTests(null);
    __setAuthRuntimeForTests(null);
    if (admin) {
      if (sourceCreated) {
        await admin.query(`DROP DATABASE IF EXISTS "${SOURCE_DB}" WITH (FORCE)`).catch(() => {});
      }
      if (targetCreatedByTest) {
        await admin.query(`DROP DATABASE IF EXISTS "${TARGET_DB}" WITH (FORCE)`).catch(() => {});
      }
      await admin.close();
    }
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  it("restarts the application and connection pool, then completes routine session rotation", async () => {
    const sourceUrl = withUserAndDb(testConfig!.connectionString, SUPERUSER, SOURCE_DB);
    const db2 = createPgDatabase({ connectionString: sourceUrl, max: 4 });
    const runtime2 = createPgApplicationRuntime(db2);
    const auth2 = createAuthRuntime(db2);
    __setAuthRuntimeForTests(auth2);
    try {
      // New runtime + new pool: persisted state and the K1 session both survive process restart.
      expect((await runtime2.tenancy.organizations.findById(organizationId))?.id).toBe(organizationId);
      expect((await runtime2.tenancy.projects.findById(projectId))?.id).toBe(projectId);
      expect((await auth2.resolveSession(cookieK1))?.userId).toBe(userId);

      // Routine window: old K1 remains valid while K2 signs fresh logins.
      __setSessionSigningKeysForTests({ current: K2, previous: K1 });
      expect((await auth2.resolveSession(cookieK1))?.userId).toBe(userId);
      const cookieK2 = await loginAndGetCookie(EMAIL);
      expect((await auth2.resolveSession(cookieK2))?.userId).toBe(userId);

      // Window closed: K1 retires, while the new K2 session remains valid.
      __setSessionSigningKeysForTests({ current: K2, previous: null });
      expect(await auth2.resolveSession(cookieK1)).toBeNull();
      expect((await auth2.resolveSession(cookieK2))?.userId).toBe(userId);
    } finally {
      __setAuthRuntimeForTests(null);
      __setSessionSigningKeysForTests(null);
      await db2.close();
    }
  });

  it("backs up, verifies checksum, restores to the fixed verify database, and preserves offline-only state", async () => {
    outputDir = mkdtempSync(join(tmpdir(), "geoplane-local-recovery-e2e-"));
    const { OPENAI_API_KEY: _openAiKey, PROVIDER_API_KEY: _providerKey, ...providerFreeEnv } =
      process.env;
    // beforeAll proved the target did not exist. Mark cleanup ownership before invocation so a
    // partially-created target is still removed if pg_restore itself fails.
    targetCreatedByTest = true;
    const output = execFileSync(
      process.execPath,
      [drillScript, "--source-db", SOURCE_DB, "--user", SUPERUSER, "--out", outputDir],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...providerFreeEnv,
          LOCAL_ONLY_MODE: "TRUE",
          REMOTE_WRITE: "FORBIDDEN",
          PROVIDER_RUNTIME_ENABLED: "false",
        },
      },
    );
    expect(output).toContain("LOCAL_RECOVERY_DRILL_V1 PASS");
    expect(output).toContain("REAL_PROVIDER_CALLS=0");
    expect(output).toContain("REMOTE_WRITE_ATTEMPTS=0");
    expect(output).toMatch(/CHECKSUM_VERIFIED sha256 [a-f0-9]{64}/);
    expect(output).toContain(`RESTORE_VERIFIED ${TARGET_DB}`);

    const restoredDb = createPgDatabase({
      connectionString: withUserAndDb(testConfig!.connectionString, SUPERUSER, TARGET_DB),
      max: 4,
    });
    const restoredRuntime = createPgApplicationRuntime(restoredDb);
    try {
      expect((await restoredRuntime.tenancy.organizations.findById(organizationId))?.id).toBe(
        organizationId,
      );
      expect((await restoredRuntime.tenancy.projects.findById(projectId))?.id).toBe(projectId);
      const user = await restoredDb.query<{ email: string }>(`SELECT email FROM "user" WHERE id = $1`, [
        userId,
      ]);
      expect(user.rows[0]?.email).toBe(EMAIL);
      const ledger = await restoredDb.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM provider_execution`,
      );
      expect(ledger.rows[0]?.n).toBe(0);
    } finally {
      await restoredDb.close();
    }
  }, HOOK_TIMEOUT);
});
