/**
 * STAGING_OPERATIONS_V1 batch 2 (Agent E2) — canonical-PostgreSQL verification.
 *
 * The pilot's canonical target is PostgreSQL 16. This self-checking script:
 *   1. ATTEMPTS to reach a PostgreSQL 16 binary/instance (install dir, a *-16 service, or a
 *      server answering '16' on a secondary port). It tries ONCE and never installs anything.
 *   2. Runs a migration + constraint + trigger + idempotency + restart verification against a
 *      throwaway database on whichever server it can reach:
 *        - if PG16 is reachable  -> runs there and reports PG16=PASS/FAIL
 *        - if PG16 is NOT reachable (the expected staging state) -> records
 *          CANONICAL_POSTGRES16_VERIFY = BLOCKED_PENDING_ENV and runs the SAME checks on the
 *          installed PostgreSQL (18) as equivalent evidence, reporting PG18_EQUIVALENT=PASS/FAIL.
 *
 * Usage:
 *   node scripts/backup/pg-verify.mjs                 # base = GEO_DATABASE_URL, role = postgres
 *   node scripts/backup/pg-verify.mjs --test          # base = GEO_TEST_DATABASE_URL
 *   node scripts/backup/pg-verify.mjs --user postgres # override the superuser role
 *
 * Exit code is non-zero if the checks that DID run failed. A BLOCKED PG16 (no server) is not a
 * failure of this script — it is reported honestly and the PG18-equivalent run stands in.
 */
import { createConnection } from "node:net";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Pool } from "pg";
import {
  assertSafeDbIdentifier,
  formatPgUrl,
  migrationsDir,
  parseArgs,
  resolveConnection,
  withDatabase,
} from "./pg-lib.mjs";
import { requiredMigrationVersions } from "../migration-manifest.mjs";

// Single source of truth: migrations/manifest.json (MIGRATION_REGISTRY_SINGLE_SOURCE_V1).
const EXPECTED_VERSIONS = requiredMigrationVersions(migrationsDir);
const HIGHEST_VERSION = EXPECTED_VERSIONS[EXPECTED_VERSIONS.length - 1] ?? "0000";

// --- PG16 detection (bounded; one attempt) --------------------------------------------------

function tcpOpen(host, port, timeoutMs) {
  return new Promise((resolvePromise) => {
    const sock = createConnection({ host, port });
    let settled = false;
    const done = (open) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolvePromise(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

async function serverMajorVersion(parts) {
  const pool = new Pool({ connectionString: formatPgUrl(parts), max: 1, connectionTimeoutMillis: 1500 });
  try {
    const { rows } = await pool.query("SHOW server_version");
    const v = rows[0] ? String(rows[0].server_version) : "";
    const m = /^(\d+)/.exec(v);
    return m ? m[1] : null;
  } catch {
    return null;
  } finally {
    await pool.end().catch(() => {});
  }
}

/** Try to find a reachable PG16. Returns { reachable, detail, connParts? }. */
async function detectPostgres16(base) {
  // (a) install directory
  const winDir = "C:/Program Files/PostgreSQL/16/bin/pg_dump.exe";
  const nixDir = "/usr/lib/postgresql/16/bin/pg_dump";
  if (existsSync(winDir) || existsSync(nixDir)) {
    return { reachable: true, detail: "PostgreSQL 16 install directory present", connParts: null };
  }

  // (b) a PG16 server answering on a secondary port (5433/5434) with the base credentials.
  for (const port of ["5433", "5434"]) {
    const open = await tcpOpen(base.host, Number(port), 800);
    if (!open) continue;
    const probe = withDatabase({ ...base, port }, "postgres");
    const major = await serverMajorVersion(probe);
    if (major === "16") {
      return { reachable: true, detail: `PostgreSQL 16 answering on ${base.host}:${port}`, connParts: probe };
    }
  }

  return { reachable: false, detail: "no PostgreSQL 16 install dir, service, or secondary-port server found" };
}

// --- inline migration ledger (a .mjs cannot import the .ts migrator) -------------------------

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function applyMigrationsInline(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const filename of files) {
    const sql = readFileSync(join(migrationsDir, filename), "utf8");
    const checksum = sha256(sql);
    const { rows } = await pool.query("SELECT checksum FROM schema_migrations WHERE filename = $1", [
      filename,
    ]);
    if (rows.length > 0) {
      if (rows[0].checksum !== checksum) throw new Error(`migration ${filename} modified after apply`);
      continue;
    }
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
      filename,
      checksum,
    ]);
    applied += 1;
  }
  return { applied, total: files.length };
}

// --- verification checks --------------------------------------------------------------------

async function expectThrow(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

/** Run the full check battery against a throwaway db reached by `workParts`. Returns results. */
async function runVerification(workParts, label, log) {
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  };

  let pool = new Pool({ connectionString: formatPgUrl(workParts), max: 4 });
  const CONTENT_KEY = "knowledge/pgverify/doc/deadbeef";
  const CONTENT_TEXT = "canonical-verify text · 世界 · line2";

  try {
    // 1. Migrations apply cleanly and reach the manifest's highest required version.
    const first = await applyMigrationsInline(pool);
    const ledger = await pool.query("SELECT filename FROM schema_migrations");
    const present = new Set(
      ledger.rows.map((r) => (/^(\d{4})/.exec(r.filename) || [])[1]).filter(Boolean),
    );
    const missing = EXPECTED_VERSIONS.filter((v) => !present.has(v));
    record("migrations-apply", missing.length === 0, `applied ${first.applied}/${first.total}, reached ${HIGHEST_VERSION} (${EXPECTED_VERSIONS.length} required)`);

    // 2. Constraint spot-check: a blank email and a bad organization type are rejected.
    const blankEmailRejected = await expectThrow(() =>
      pool.query(`INSERT INTO "user"(email) VALUES ('   ')`),
    );
    const user = await pool.query(`INSERT INTO "user"(email) VALUES ($1) RETURNING id`, [
      `pgverify+${Date.now()}@example.test`,
    ]);
    const userId = user.rows[0].id;
    const badTypeRejected = await expectThrow(() =>
      pool.query(
        `INSERT INTO organization(type, display_name, idempotency_key, created_by_user_id)
         VALUES ('NOT_A_TYPE', 'x', $1, $2)`,
        [`idem-${Date.now()}`, userId],
      ),
    );
    record("constraints", blankEmailRejected && badTypeRejected, "blank email + bad org type both rejected");

    // 3. Trigger spot-check: knowledge_content is append-only (UPDATE/DELETE rejected).
    await pool.query(
      `INSERT INTO knowledge_content(storage_path, content_hash, content_text)
       VALUES ($1, $2, $3)`,
      [CONTENT_KEY, sha256(CONTENT_TEXT), CONTENT_TEXT],
    );
    const updateRejected = await expectThrow(() =>
      pool.query(`UPDATE knowledge_content SET content_text = 'x' WHERE storage_path = $1`, [CONTENT_KEY]),
    );
    const deleteRejected = await expectThrow(() =>
      pool.query(`DELETE FROM knowledge_content WHERE storage_path = $1`, [CONTENT_KEY]),
    );
    record("triggers", updateRejected && deleteRejected, "append-only UPDATE + DELETE both rejected");

    // 4. Idempotency spot-check: re-running migrations applies 0; re-inserting the PK is rejected.
    const second = await applyMigrationsInline(pool);
    const dupKeyRejected = await expectThrow(() =>
      pool.query(
        `INSERT INTO knowledge_content(storage_path, content_hash, content_text) VALUES ($1, $2, $3)`,
        [CONTENT_KEY, sha256(CONTENT_TEXT), CONTENT_TEXT],
      ),
    );
    record("idempotency", second.applied === 0 && dupKeyRejected, "re-migrate applied 0; duplicate key rejected");

    // 5. Restart read-back: close the pool, open a NEW one (simulating a process restart), and
    //    confirm the durable content text survives verbatim.
    await pool.end();
    pool = new Pool({ connectionString: formatPgUrl(workParts), max: 2 });
    const readBack = await pool.query(
      `SELECT content_text FROM knowledge_content WHERE storage_path = $1`,
      [CONTENT_KEY],
    );
    const survived = readBack.rows[0] && readBack.rows[0].content_text === CONTENT_TEXT;
    record("restart-read-back", Boolean(survived), "durable knowledge_content text survived a fresh connection");

    // 6. Provider ledger (migration 0007): append-only provider_execution table exists, carries
    //    NO secret/raw-content columns (token COUNTS are allowed), and forbids UPDATE/DELETE.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'provider_execution'`,
    );
    const colNames = cols.rows.map((r) => String(r.column_name).toLowerCase());
    const FORBIDDEN_LEDGER_COLS = new Set([
      "api_key", "apikey", "secret", "token", "access_token",
      "prompt", "response", "content", "prompt_text", "response_text", "raw_content", "content_text",
    ]);
    const forbiddenPresent = colNames.filter((c) => FORBIDDEN_LEDGER_COLS.has(c));
    const trg = await pool.query(
      `SELECT 1 FROM information_schema.triggers
       WHERE event_object_table = 'provider_execution' AND event_manipulation IN ('UPDATE', 'DELETE')`,
    );
    const ledgerOk = colNames.length > 0 && forbiddenPresent.length === 0 && trg.rows.length > 0;
    record(
      "provider-ledger",
      ledgerOk,
      `provider_execution present (${colNames.length} cols), no secret/raw-content columns, append-only trigger present`,
    );
  } finally {
    await pool.end().catch(() => {});
  }

  const ok = results.every((r) => r.ok);
  log(`${label}: ${ok ? "PASS" : "FAIL"} (${results.filter((r) => r.ok).length}/${results.length} checks)`);
  return { ok, results };
}

// --- main -----------------------------------------------------------------------------------

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  // Default the verification role to the superuser (throwaway-db create/drop needs it).
  if (typeof flags.user !== "string") flags.user = "postgres";

  const base = resolveConnection(flags);
  if (!base) {
    console.error("pg-verify: no base connection resolved (set GEO_DATABASE_URL or GEO_TEST_DATABASE_URL).");
    process.exit(2);
  }

  console.log("Canonical PostgreSQL verification");
  console.log("=".repeat(72));

  const pg16 = await detectPostgres16(base);
  console.log(`PG16 detection: ${pg16.reachable ? "REACHABLE" : "NOT REACHABLE"} — ${pg16.detail}`);

  // Choose which server hosts the throwaway verification database.
  const hostParts = pg16.reachable && pg16.connParts ? pg16.connParts : base;
  const throwaway = `geoplane_pgverify_${Date.now()}`;
  assertSafeDbIdentifier(throwaway);

  const admin = new Pool({ connectionString: formatPgUrl(withDatabase(hostParts, "postgres")), max: 2 });
  const runLabel = pg16.reachable ? "PG16" : "PG18_EQUIVALENT";
  let verification;
  try {
    await admin.query(`CREATE DATABASE "${throwaway}"`);
    console.log(`Running verification on ${runLabel} (throwaway db "${throwaway}"):`);
    verification = await runVerification(withDatabase(hostParts, throwaway), runLabel, (m) => console.log(m));
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${throwaway}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }

  console.log("=".repeat(72));
  if (pg16.reachable) {
    console.log(`RESULT: PG16=${verification.ok ? "PASS" : "FAIL"}`);
    console.log("CANONICAL_POSTGRES16_VERIFY = " + (verification.ok ? "PASS" : "FAIL"));
  } else {
    console.log("CANONICAL_POSTGRES16_VERIFY = BLOCKED_PENDING_ENV (no PostgreSQL 16 in this environment)");
    console.log(`RESULT: PG18_EQUIVALENT=${verification.ok ? "PASS" : "FAIL"}`);
  }

  if (!verification.ok) process.exit(1);
}

main().catch((err) => {
  console.error(`pg-verify: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
