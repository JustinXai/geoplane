/**
 * CI_REPRODUCIBLE_DATABASE_GATE_V1 (Agent C) — backup/restore gate on the CI test database.
 *
 *   node scripts/ci/run-backup-restore-gate.mjs
 *
 * Against the CI test database (populated by the closed-pilot suite via
 * run-database-gates.mjs — or seeded here with minimal sanitized rows when
 * completely empty):
 *   1. backup via scripts/backup/backup.mjs (custom format), then RE-HASH the
 *      artifact and verify the sha256 checksum the CLI printed;
 *   2. restore into a fresh uniquely-named database via scripts/backup/restore.mjs;
 *   3. read back over SQL: accounts, knowledge raw content, opportunities,
 *      articles/deliveries, audit events, and provider_execution rows INCLUDING
 *      their gateway_vendor / model_vendor / protocol identity values;
 *   4. verify UPDATE and DELETE on provider_execution are REJECTED post-restore
 *      (the append-only triggers survived the dump/restore);
 *   5. drop the throwaway restored database and write artifacts/ci/backup-restore.json.
 *
 * Requires pg_dump/pg_restore (CI installs postgresql-client-16; a local PG18
 * client works the same — located via scripts/backup/pg-lib.mjs).
 *
 * HARD SAFETY: reuses the production/recovery-name guard for every database it
 * touches; passwords only travel in env connection strings (never argv, never
 * printed); DEEPSEEK_API_KEY is stripped unread from child envs; failures exit
 * non-zero with a classified CI_BACKUP_GATE_* message.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import {
  assertNotProtectedDb,
  assertSafeDbIdentifier,
  formatPgUrl,
  repoRoot,
  sha256File,
  withDatabase,
} from "../backup/pg-lib.mjs";
import { CiGateError, resolveCiTopology } from "./create-isolated-databases.mjs";

const CHECKPOINT = "CI_REPRODUCIBLE_DATABASE_GATE_V1";
const PHASE = "AUTOMATED_PG16_RELEASE_GATE_V1";
const artifactsDir = join(repoRoot, "artifacts", "ci");
const OUTPUT_JSON = join(artifactsDir, "backup-restore.json");

const CATEGORY_TABLES = {
  accounts: `"user"`,
  knowledge: "knowledge_content",
  opportunities: "opportunity",
  articles: "article_draft",
  deliveries: "delivery",
  auditEvents: "audit_event",
  providerExecutions: "provider_execution",
};
// Categories the minimal seed can populate; all of these must be non-zero for
// the gate to PASS. articles/deliveries additionally require source==restored
// equality (the orchestrated flow populates them via the closed-pilot suite).
const REQUIRED_NONZERO = ["accounts", "knowledge", "opportunities", "auditEvents", "providerExecutions"];

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Spawn a child with a custom env, capturing output. Non-zero exit -> classified error. */
function runCapture(label, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(new CiGateError("CI_BACKUP_GATE_SPAWN_FAILED", `${label}: ${err.message}`)));
    child.on("close", (code) => {
      process.stdout.write(stdout);
      if (stderr.trim()) process.stderr.write(stderr);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new CiGateError("CI_BACKUP_GATE_CHILD_FAILED", `${label} exited with code ${code}`));
    });
  });
}

async function categoryCounts(pool) {
  const counts = {};
  for (const [category, table] of Object.entries(CATEGORY_TABLES)) {
    counts[category] = Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
  }
  return counts;
}

async function providerIdentityRows(pool) {
  const { rows } = await pool.query(
    `SELECT id, model, gateway_vendor, model_vendor, protocol
       FROM provider_execution ORDER BY created_at, id LIMIT 100`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    model: String(r.model),
    gateway_vendor: String(r.gateway_vendor),
    model_vendor: String(r.model_vendor),
    protocol: String(r.protocol),
  }));
}

async function knowledgeContentHashes(pool) {
  const { rows } = await pool.query(
    `SELECT storage_path, content_text FROM knowledge_content ORDER BY storage_path LIMIT 5`,
  );
  return rows.map((r) => ({ storagePath: String(r.storage_path), textSha256: sha256(String(r.content_text)) }));
}

/** Minimal, fully sanitized seed (only used when the CI test db is empty). */
async function seedMinimalRows(pool) {
  const ts = Date.now();
  const user = await pool.query(`INSERT INTO "user"(email) VALUES ($1) RETURNING id`, [
    `ci-backup-seed+${ts}@example.test`,
  ]);
  const userId = user.rows[0].id;
  const org = await pool.query(
    `INSERT INTO organization(type, display_name, idempotency_key, created_by_user_id)
     VALUES ('CLIENT', 'Sample Client (Pilot Fixture)', $1, $2) RETURNING id`,
    [`ci-backup-seed-org-${ts}`, userId],
  );
  const orgId = org.rows[0].id;
  const project = await pool.query(
    `INSERT INTO project(client_organization_id, name, created_by_user_id)
     VALUES ($1, 'Sample Project (Pilot Fixture)', $2) RETURNING id`,
    [orgId, userId],
  );
  const projectId = project.rows[0].id;
  const contentText = "Sample knowledge raw content (Pilot Fixture) · 世界";
  await pool.query(
    `INSERT INTO knowledge_content(storage_path, content_hash, content_text) VALUES ($1, $2, $3)`,
    [`knowledge/ci-backup-seed/${ts}`, sha256(contentText), contentText],
  );
  await pool.query(
    `INSERT INTO audit_event(organization_id, actor_user_id, actor_organization_id, action, event_hash)
     VALUES ($1, $2, $1, 'CI_BACKUP_SEED', $3)`,
    [orgId, userId, sha256(`CI_BACKUP_SEED:${ts}`)],
  );
  const map = await pool.query(
    `INSERT INTO keyword_question_map(client_organization_id, project_id, knowledge_package_id,
                                      knowledge_package_version, industry_profile_id)
     VALUES ($1, $2, gen_random_uuid(), 1, gen_random_uuid()) RETURNING id`,
    [orgId, projectId],
  );
  await pool.query(
    `INSERT INTO opportunity(client_organization_id, project_id, keyword_question_map_id, keyword,
                             grounding_knowledge_package_id, grounding_knowledge_package_version)
     VALUES ($1, $2, $3, 'sample keyword (pilot fixture)', gen_random_uuid(), 1)`,
    [orgId, projectId, map.rows[0].id],
  );
  // OFFLINE metadata only — model 'offline-deterministic' is NOT a real model
  // and the evidence counter excludes it. No real provider call happens here.
  await pool.query(
    `INSERT INTO provider_execution(request_id, idempotency_key, project_id, client_organization_id,
                                    article_brief_id, model, status, prompt_tokens, completion_tokens,
                                    total_tokens, latency_ms, gateway_vendor, model_vendor, protocol)
     VALUES ('ci-backup-seed', $1, $2, $3, $4, 'offline-deterministic', 'OK', 0, 0, 0, 0,
             'CUSTOM_OPENAI_COMPATIBLE', 'OTHER', 'OPENAI_COMPATIBLE')`,
    [`ci-backup-seed-${ts}`, projectId, orgId, randomUUID()],
  );
}

async function expectAppendOnlyRejected(pool, table, id) {
  const attempt = async (sql) => {
    try {
      await pool.query(sql, [id]);
      return null;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  };
  const upd = await attempt(`UPDATE ${table} SET model = model WHERE id = $1`);
  const del = await attempt(`DELETE FROM ${table} WHERE id = $1`);
  return (
    upd !== null && del !== null && /append-only/i.test(upd.message) && /append-only/i.test(del.message)
  );
}

async function main() {
  const topology = resolveCiTopology();
  mkdirSync(artifactsDir, { recursive: true });

  const childEnvBase = { ...process.env };
  delete childEnvBase.DEEPSEEK_API_KEY; // stripped unread — hard safety
  childEnvBase.PROVIDER_RUNTIME_ENABLED = "false";

  const result = {
    checkpoint: CHECKPOINT,
    phase: PHASE,
    generatedAt: null,
    testDatabase: topology.databases.test,
    seeded: false,
    backup: { status: "NOT_RUN" },
    restore: { status: "NOT_RUN" },
    readBack: { status: "NOT_RUN" },
  };

  const freshDb = `geoplane_ci_bkr_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  assertSafeDbIdentifier(freshDb);
  assertNotProtectedDb(freshDb, "restore into");
  assertNotProtectedDb(topology.databases.test, "back up");

  const backupDir = mkdtempSync(join(tmpdir(), "geoplane-ci-bkr-"));
  const adminMaintenance = new Pool({
    connectionString: formatPgUrl(withDatabase(topology.admin, "postgres")),
    max: 2,
  });
  let restoredCreated = false;

  try {
    // ---- source snapshot (and seed when completely empty) ----
    const sourcePool = new Pool({ connectionString: topology.urlFor("test"), max: 2 });
    let sourceCounts;
    let sourceProviderRows;
    let sourceKnowledge;
    try {
      sourceCounts = await categoryCounts(sourcePool);
      if (Object.values(sourceCounts).every((n) => n === 0)) {
        console.log("run-backup-restore-gate: CI test database is empty — seeding minimal sanitized rows.");
        await seedMinimalRows(sourcePool);
        result.seeded = true;
        sourceCounts = await categoryCounts(sourcePool);
      }
      const missing = REQUIRED_NONZERO.filter((c) => sourceCounts[c] === 0);
      if (missing.length > 0) {
        throw new CiGateError(
          "CI_BACKUP_GATE_SOURCE_EMPTY",
          `required categories have zero rows in the source: ${missing.join(", ")}`,
        );
      }
      sourceProviderRows = await providerIdentityRows(sourcePool);
      sourceKnowledge = await knowledgeContentHashes(sourcePool);
    } finally {
      await sourcePool.end().catch(() => undefined);
    }
    console.log(
      `run-backup-restore-gate: source counts = ${Object.entries(sourceCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ")}`,
    );

    // ---- 1. backup via the real CLI (app-role connection from env; custom format) ----
    const backupEnv = { ...childEnvBase, GEO_TEST_DATABASE_URL: topology.urlFor("test") };
    const backupOut = await runCapture(
      "backup.mjs",
      [join(repoRoot, "scripts", "backup", "backup.mjs"), "--test", "--out", backupDir],
      backupEnv,
    );
    const artifactLine = backupOut.stdout.split(/\r?\n/).find((l) => l.startsWith("ARTIFACT "));
    const checksumLine = backupOut.stdout.split(/\r?\n/).find((l) => l.startsWith("CHECKSUM sha256 "));
    if (!artifactLine || !checksumLine) {
      throw new CiGateError("CI_BACKUP_GATE_BACKUP_OUTPUT", "backup.mjs did not print ARTIFACT and CHECKSUM lines");
    }
    const artifact = artifactLine.slice("ARTIFACT ".length).trim();
    const printedChecksum = checksumLine.slice("CHECKSUM sha256 ".length).trim();
    const recomputed = await sha256File(artifact);
    if (recomputed !== printedChecksum) {
      result.backup = { status: "FAIL", artifact, printedChecksum, recomputed, checksumVerified: false };
      throw new CiGateError(
        "CI_BACKUP_GATE_CHECKSUM_MISMATCH",
        "re-hashed artifact sha256 does not match the checksum backup.mjs printed",
      );
    }
    result.backup = {
      status: "PASS",
      artifactSizeBytes: statSync(artifact).size,
      sha256: recomputed,
      checksumVerified: true,
    };
    console.log("run-backup-restore-gate: backup checksum re-hashed and verified.");

    // ---- 2. restore into a fresh uniquely-named database via the real CLI ----
    // The restore child gets an ADMIN-credentialed base URL via env (CREATE
    // DATABASE needs it; the app role is deliberately NOCREATEDB). The password
    // stays inside the env connection string — never on the command line.
    const restoreEnv = {
      ...childEnvBase,
      GEO_TEST_DATABASE_URL: formatPgUrl(withDatabase(topology.admin, topology.databases.test)),
    };
    await runCapture(
      "restore.mjs",
      [
        join(repoRoot, "scripts", "backup", "restore.mjs"),
        "--test",
        "--db",
        freshDb,
        "--dump",
        artifact,
      ],
      restoreEnv,
    );
    restoredCreated = true;
    result.restore = { status: "PASS", restoredDatabase: freshDb, dropped: false };

    // ---- 3+4. read back over SQL + append-only verification post-restore ----
    const restoredPool = new Pool({
      connectionString: formatPgUrl(withDatabase(topology.admin, freshDb)),
      max: 2,
    });
    try {
      const restoredCounts = await categoryCounts(restoredPool);
      const counts = {};
      const mismatches = [];
      for (const category of Object.keys(CATEGORY_TABLES)) {
        counts[category] = { source: sourceCounts[category], restored: restoredCounts[category] };
        if (sourceCounts[category] !== restoredCounts[category]) mismatches.push(category);
      }

      const restoredProviderRows = await providerIdentityRows(restoredPool);
      const restoredById = new Map(restoredProviderRows.map((r) => [r.id, r]));
      const identityMismatch = sourceProviderRows.filter((src) => {
        const dst = restoredById.get(src.id);
        return (
          !dst ||
          dst.model !== src.model ||
          dst.gateway_vendor !== src.gateway_vendor ||
          dst.model_vendor !== src.model_vendor ||
          dst.protocol !== src.protocol
        );
      });
      const providerIdentityVerified = identityMismatch.length === 0 && sourceProviderRows.length > 0;

      const restoredKnowledge = await knowledgeContentHashes(restoredPool);
      const restoredByPath = new Map(restoredKnowledge.map((k) => [k.storagePath, k.textSha256]));
      const knowledgeContentVerified =
        sourceKnowledge.length > 0 &&
        sourceKnowledge.every((k) => restoredByPath.get(k.storagePath) === k.textSha256);

      const ledgerRow = await restoredPool.query(
        `SELECT id FROM provider_execution ORDER BY created_at, id LIMIT 1`,
      );
      const appendOnlyOk =
        ledgerRow.rowCount > 0 &&
        (await expectAppendOnlyRejected(restoredPool, "provider_execution", ledgerRow.rows[0].id));

      const readBackOk =
        mismatches.length === 0 && providerIdentityVerified && knowledgeContentVerified && appendOnlyOk;
      result.readBack = {
        status: readBackOk ? "PASS" : "FAIL",
        counts,
        providerIdentityVerified,
        providerIdentitySample: restoredProviderRows.slice(0, 3).map(({ id, ...identity }) => identity),
        knowledgeContentVerified,
        appendOnlyPostRestore: appendOnlyOk ? "PASS" : "FAIL",
      };
      if (!readBackOk) {
        throw new CiGateError(
          "CI_BACKUP_GATE_READBACK_FAILED",
          [
            mismatches.length > 0 ? `count mismatch in: ${mismatches.join(", ")}` : null,
            providerIdentityVerified ? null : "provider identity (gateway/model vendor/protocol) mismatch or empty",
            knowledgeContentVerified ? null : "knowledge raw content hash mismatch or empty",
            appendOnlyOk ? null : "UPDATE/DELETE on provider_execution was NOT rejected post-restore",
          ]
            .filter(Boolean)
            .join("; "),
        );
      }
      console.log(
        "run-backup-restore-gate: read-back verified (counts equal, provider identity intact, " +
          "knowledge content intact, provider_execution still append-only).",
      );
    } finally {
      await restoredPool.end().catch(() => undefined);
    }
  } finally {
    // Always drop the throwaway restored database and the dump directory.
    if (restoredCreated) {
      try {
        await adminMaintenance.query(`DROP DATABASE IF EXISTS "${freshDb}" WITH (FORCE)`);
        if (result.restore.status === "PASS") result.restore.dropped = true;
        console.log(`run-backup-restore-gate: dropped throwaway restored database "${freshDb}".`);
      } catch (err) {
        console.error(`run-backup-restore-gate: WARNING — could not drop "${freshDb}": ${err.message}`);
      }
    }
    await adminMaintenance.end().catch(() => undefined);
    rmSync(backupDir, { recursive: true, force: true });
    result.generatedAt = new Date().toISOString();
    writeFileSync(OUTPUT_JSON, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`run-backup-restore-gate: wrote ${OUTPUT_JSON}`);
  }

  console.log("run-backup-restore-gate: PASS.");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`run-backup-restore-gate: FAILED — ${msg}`);
  process.exit(1);
});
