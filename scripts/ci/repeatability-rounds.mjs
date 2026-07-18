/**
 * CRITICAL_GATE_REPEATABILITY_V1 (phase AUTOMATED_PG16_RELEASE_GATE_V1, Agent D) — prove the
 * critical release gates are REPEATABLE, not accidentally green.
 *
 *   node scripts/ci/repeatability-rounds.mjs
 *
 * Runs THREE consecutive rounds. Each round provisions FRESH, uniquely-named throwaway
 * databases on the local PostgreSQL instance —
 *   geoplane_rep_r<N>_test          (the round's test database; never reused across rounds)
 *   geoplane_rep_r<N>_restore_test  (the round's backup→restore target)
 * — and runs the seven critical gates against them by overriding GEO_TEST_DATABASE_URL in the
 * child-process environment (every existing tool/suite resolves process.env first):
 *
 *   1. migration-apply-0001-0008   scripts/db/migrate.mjs --test   (fresh DB, 8 files applied)
 *   2. db-purpose-preflight        scripts/preflight/database-environment.mjs
 *   3. tenant-isolation            vitest tests/persistence/ (pg tenancy suites)
 *   4. concurrent-idempotency      vitest -t "collapses 10 concurrent same-key creates …"
 *   5. provider-ledger-append-only vitest provider-ledger + provider-identity-migration suites
 *   6. product-restart-e2e         vitest tests/pilot/pilot-resilience.e2e.pg.test.ts
 *   7. backup-restore-e2e          scripts/backup/backup.mjs → scripts/backup/restore.mjs into
 *                                  the round's fresh restore DB, then count verification
 *
 * Honesty rules (the whole point of this audit):
 *   - a vitest gate whose tests SKIP is a FAIL — "green by skipping" is the accident this
 *     script exists to catch (each *.pg suite skips silently when no test DB resolves);
 *   - no rerun-until-green: every round's raw result is recorded as it happened;
 *   - before each round the script verifies that round's databases DO NOT already exist
 *     (residual-state check), and after each round it drops them and verifies they are gone.
 *
 * Results (per-round, per-gate status/duration/test-counts + cross-round analysis) are written
 * to artifacts/ci/repeatability.json — a LOCAL evidence artifact, NOT committed. Full child
 * logs land in a per-run directory under the OS temp dir (path printed at start).
 *
 * Safety: reuses the scripts/backup/pg-lib.mjs guards — production/recovery-named databases
 * are refused, database identifiers are validated before interpolation. Passwords flow only
 * through the child environment (GEO_TEST_DATABASE_URL / PGPASSWORD) and are NEVER printed or
 * written to any log/artifact. Zero provider calls: RUN_PROVIDER_CANARY is stripped from every
 * child environment and only offline suites are invoked. The admin role ('postgres', password
 * shared with the .env.local connection — ENV FACT, same as tests/runtime/staging) is used
 * exclusively for CREATE/DROP DATABASE and read-only verification queries.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import {
  assertNotProtectedDb,
  assertSafeDbIdentifier,
  fileTimestamp,
  formatPgUrl,
  parsePgUrl,
  repoRoot,
  resolveVar,
  withDatabase,
} from "../backup/pg-lib.mjs";

const ROUNDS = 3;
const ADMIN_ROLE = "postgres";
const vitestMjs = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const migrateScript = join(repoRoot, "scripts", "db", "migrate.mjs");
const preflightScript = join(repoRoot, "scripts", "preflight", "database-environment.mjs");
const backupScript = join(repoRoot, "scripts", "backup", "backup.mjs");
const restoreScript = join(repoRoot, "scripts", "backup", "restore.mjs");
const artifactPath = join(repoRoot, "artifacts", "ci", "repeatability.json");

// --- base connection resolution (never printed) ---------------------------------------------

const baseTestUrl = resolveVar("GEO_TEST_DATABASE_URL");
if (!baseTestUrl) {
  console.error("repeatability: GEO_TEST_DATABASE_URL is not set (checked process.env and .env.local).");
  process.exit(2);
}
const baseParts = parsePgUrl(baseTestUrl);
const appRole = baseParts.user;
assertSafeDbIdentifier(appRole);
const adminUrl = formatPgUrl(withDatabase({ ...baseParts, user: ADMIN_ROLE }, "postgres"));

/** Connection URL for the round's throwaway test DB, as the normal app/test role. */
function roundTestUrl(database) {
  return formatPgUrl(withDatabase(baseParts, database));
}

/** Child env: base test URL swapped for the round DB; the canary can never arm. */
function childEnv(roundUrl) {
  const env = { ...process.env, GEO_TEST_DATABASE_URL: roundUrl };
  delete env.RUN_PROVIDER_CANARY; // offline only — no provider call can occur inside this audit
  return env;
}

// --- child process runner (captures everything, never throws) -------------------------------

function run(cmd, args, env) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd: repoRoot, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      resolvePromise({ code: -1, stdout, stderr: `${stderr}\n${String(err)}`, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

// --- admin helpers (CREATE/DROP DATABASE + verification only) -------------------------------

async function withAdmin(database, fn) {
  const pool = new Pool({
    connectionString: database === "postgres" ? adminUrl : formatPgUrl(withDatabase({ ...baseParts, user: ADMIN_ROLE }, database)),
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function listRepDatabases() {
  return withAdmin("postgres", async (pool) => {
    const { rows } = await pool.query("SELECT datname FROM pg_database WHERE datname ~ '^geoplane_rep_' ORDER BY datname");
    return rows.map((r) => r.datname);
  });
}

async function createRoundDb(name, owner) {
  assertSafeDbIdentifier(name);
  assertNotProtectedDb(name, "create");
  assertSafeDbIdentifier(owner);
  await withAdmin("postgres", (pool) => pool.query(`CREATE DATABASE "${name}" OWNER "${owner}"`));
}

async function dropDb(name) {
  assertSafeDbIdentifier(name);
  assertNotProtectedDb(name, "drop");
  await withAdmin("postgres", (pool) => pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

/** Read-only shape facts used to verify the backup→restore round-trip. */
async function dbShape(name) {
  return withAdmin(name, async (pool) => {
    const tables = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const triggers = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.triggers WHERE trigger_schema = 'public'`,
    );
    let ledger = 0;
    try {
      ledger = (await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n;
    } catch {
      ledger = -1; // ledger table missing
    }
    return { tables: tables.rows[0].n, triggers: triggers.rows[0].n, ledger };
  });
}

// --- vitest gate runner ---------------------------------------------------------------------

async function runVitestGate({ files, testNamePattern, allowFiltered = false, exactPassed = null, env, jsonPath }) {
  const args = [vitestMjs, "run", ...files, "--reporter=json", `--outputFile=${jsonPath}`];
  if (testNamePattern) args.push("-t", testNamePattern);
  const res = await run(process.execPath, args, env);

  let summary = null;
  try {
    summary = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    summary = null;
  }
  const counts = summary
    ? {
        total: summary.numTotalTests,
        passed: summary.numPassedTests,
        failed: summary.numFailedTests,
        skipped: summary.numPendingTests,
        todo: summary.numTodoTests,
      }
    : null;

  let status = "FAIL";
  let reason = null;
  if (res.code !== 0) reason = `vitest exited with code ${res.code}`;
  else if (!summary) reason = "vitest produced no JSON summary";
  else if (summary.success !== true) reason = "vitest reported success=false";
  else if (counts.failed > 0) reason = `${counts.failed} test(s) failed`;
  else if (counts.passed < 1) reason = "ZERO tests ran — a skipped suite is not a green gate";
  else if (!allowFiltered && counts.skipped > 0) reason = `${counts.skipped} test(s) skipped — a skipped test is not a green test`;
  else if (exactPassed !== null && counts.passed !== exactPassed) reason = `expected exactly ${exactPassed} passing test(s), saw ${counts.passed}`;
  else status = "PASS";

  return { status, reason, durationMs: res.durationMs, exitCode: res.code, counts, stdout: res.stdout, stderr: res.stderr };
}

// --- the seven gates ------------------------------------------------------------------------

function buildGates(round) {
  const db = round.database;
  const restoreDb = round.restoreDatabase;
  const env = childEnv(round.url);

  return [
    {
      id: "migration-apply-0001-0008",
      run: async () => {
        const res = await run(process.execPath, [migrateScript, "--test"], env);
        const applied = /migrate: done \((\d+) applied/.exec(res.stdout);
        const skips = /^skip\s+/m.test(res.stdout);
        let status = "FAIL";
        let reason = null;
        if (res.code !== 0) reason = `migrate exited with code ${res.code}`;
        else if (!applied || Number(applied[1]) !== 8) reason = `expected 8 fresh applies, saw ${applied ? applied[1] : "none"}`;
        else if (skips) reason = "migration files were skipped — the database was not fresh";
        else status = "PASS";
        return { status, reason, durationMs: res.durationMs, exitCode: res.code, details: { applied: applied ? Number(applied[1]) : 0 }, stdout: res.stdout, stderr: res.stderr };
      },
    },
    {
      id: "db-purpose-preflight",
      run: async () => {
        const res = await run(process.execPath, [preflightScript], env);
        let status = "FAIL";
        let reason = null;
        if (res.code !== 0) reason = `preflight exited with code ${res.code}`;
        else if (!res.stdout.includes("RESULT: PASS")) reason = "preflight did not report RESULT: PASS";
        else if (!res.stdout.includes(`db=${db}`)) reason = `preflight did not validate the round database ${db}`;
        else status = "PASS";
        return { status, reason, durationMs: res.durationMs, exitCode: res.code, details: { validatedRoundDb: res.stdout.includes(`db=${db}`) }, stdout: res.stdout, stderr: res.stderr };
      },
    },
    {
      id: "tenant-isolation",
      run: (jsonPath) =>
        runVitestGate({
          files: ["tests/persistence/pg-tenancy-runtime.pg.test.ts", "tests/persistence/pg-tenancy-b2.pg.test.ts"],
          env,
          jsonPath,
        }),
    },
    {
      id: "concurrent-idempotency",
      run: (jsonPath) =>
        runVitestGate({
          files: ["tests/persistence/pg-tenancy-runtime.pg.test.ts"],
          testNamePattern: "collapses 10 concurrent same-key creates into exactly one organization",
          allowFiltered: true, // -t marks the non-matching tests of the file as skipped
          exactPassed: 1,
          env,
          jsonPath,
        }),
    },
    {
      id: "provider-ledger-append-only",
      run: (jsonPath) =>
        runVitestGate({
          files: [
            "tests/runtime/provider/provider-ledger.pg.test.ts",
            "tests/runtime/provider/provider-identity-migration.pg.test.ts",
          ],
          env,
          jsonPath,
        }),
    },
    {
      id: "product-restart-e2e",
      run: (jsonPath) =>
        runVitestGate({
          files: ["tests/pilot/pilot-resilience.e2e.pg.test.ts"],
          env,
          jsonPath,
        }),
    },
    {
      id: "backup-restore-e2e",
      run: async () => {
        const started = Date.now();
        const details = {};
        const logs = [];

        // (a) dump the round database via the real backup CLI
        const backupRes = await run(process.execPath, [backupScript, "--test", "--out", round.dumpDir], env);
        logs.push("--- backup stdout ---", backupRes.stdout, "--- backup stderr ---", backupRes.stderr);
        const artifactMatch = /^ARTIFACT (.+)$/m.exec(backupRes.stdout);
        if (backupRes.code !== 0 || !artifactMatch) {
          return {
            status: "FAIL",
            reason: `backup CLI failed (exit ${backupRes.code})`,
            durationMs: Date.now() - started,
            exitCode: backupRes.code,
            details,
            stdout: logs.join("\n"),
            stderr: "",
          };
        }
        const dumpFile = artifactMatch[1].trim();
        details.dumpFile = dumpFile;

        // (b) shape of the source before restore (read-only)
        const source = await dbShape(db);
        details.source = source;

        // (c) restore into the round's FRESH restore database via the real restore CLI
        const restoreRes = await run(
          process.execPath,
          [restoreScript, "--test", "--dump", dumpFile, "--db", restoreDb, "--user", ADMIN_ROLE],
          env,
        );
        logs.push("--- restore stdout ---", restoreRes.stdout, "--- restore stderr ---", restoreRes.stderr);
        if (restoreRes.code !== 0) {
          return {
            status: "FAIL",
            reason: `restore CLI failed (exit ${restoreRes.code})`,
            durationMs: Date.now() - started,
            exitCode: restoreRes.code,
            details,
            stdout: logs.join("\n"),
            stderr: "",
          };
        }

        // (d) verify the restored copy matches the source shape and carries the full ledger
        const restored = await dbShape(restoreDb);
        details.restored = restored;
        let status = "FAIL";
        let reason = null;
        if (restored.tables !== source.tables) reason = `restored table count ${restored.tables} != source ${source.tables}`;
        else if (restored.triggers !== source.triggers) reason = `restored trigger count ${restored.triggers} != source ${source.triggers}`;
        else if (restored.ledger !== 8) reason = `restored schema_migrations has ${restored.ledger} rows, expected 8`;
        else status = "PASS";

        return { status, reason, durationMs: Date.now() - started, exitCode: 0, details, stdout: logs.join("\n"), stderr: "" };
      },
    },
  ];
}

// --- main -----------------------------------------------------------------------------------

async function main() {
  const startedAt = new Date();
  const runStamp = fileTimestamp(startedAt);
  const workDir = join(tmpdir(), "geoplane-repeatability", runStamp);
  mkdirSync(workDir, { recursive: true });

  const serverVersion = await withAdmin("postgres", async (pool) => (await pool.query("SHOW server_version")).rows[0].server_version);
  const vitestConfig = readFileSync(join(repoRoot, "vitest.config.ts"), "utf8");
  const fileParallelismDisabled = /fileParallelism:\s*false/.test(vitestConfig);

  console.log("CRITICAL_GATE_REPEATABILITY_V1 — three-round repeatability audit");
  console.log("=".repeat(72));
  console.log(`  server        : ${baseParts.host}:${baseParts.port} (PostgreSQL ${serverVersion})`);
  console.log(`  app role      : ${appRole}   admin role: ${ADMIN_ROLE} (password via env only)`);
  console.log(`  logs/dumps    : ${workDir}`);
  console.log(`  fileParallelism disabled in vitest.config.ts: ${fileParallelismDisabled}`);
  console.log("=".repeat(72));

  const rounds = [];

  for (let n = 1; n <= ROUNDS; n += 1) {
    const database = `geoplane_rep_r${n}_test`;
    const restoreDatabase = `geoplane_rep_r${n}_restore_test`;
    const dumpDir = join(workDir, `round${n}-dumps`);
    mkdirSync(dumpDir, { recursive: true });

    const round = {
      round: n,
      database,
      restoreDatabase,
      url: roundTestUrl(database),
      dumpDir,
      startedAt: new Date().toISOString(),
      residual: null,
      gates: [],
    };

    // Residual-state check: this round's databases must NOT exist before we create them.
    const preexisting = await listRepDatabases();
    const collisions = preexisting.filter((d) => d === database || d === restoreDatabase);
    round.residual = { preexistingRepDatabases: preexisting, roundDbsAbsentBeforeCreate: collisions.length === 0 };
    if (collisions.length > 0) {
      console.log(`  [r${n}] RESIDUAL STATE: ${collisions.join(", ")} already existed — dropping and flagging`);
      for (const c of collisions) await dropDb(c);
    }

    await createRoundDb(database, appRole);
    console.log(`\n  [r${n}] created fresh database ${database} (owner ${appRole})`);

    for (const gate of buildGates(round)) {
      const jsonPath = join(workDir, `round${n}-${gate.id}.vitest.json`);
      const result = await gate.run(jsonPath);
      const record = {
        id: gate.id,
        status: result.status,
        reason: result.reason ?? null,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        counts: result.counts ?? null,
        details: result.details ?? null,
      };
      round.gates.push(record);
      writeFileSync(
        join(workDir, `round${n}-${gate.id}.log`),
        `${result.stdout ?? ""}\n--- stderr ---\n${result.stderr ?? ""}`,
      );
      const countsNote = record.counts ? ` tests=${record.counts.passed}/${record.counts.total}` : "";
      console.log(
        `  [r${n}] ${gate.id.padEnd(28)} ${record.status}${countsNote} (${(record.durationMs / 1000).toFixed(1)}s)${
          record.reason ? ` — ${record.reason}` : ""
        }`,
      );
    }

    // Drop the round's databases and verify nothing is left behind.
    await dropDb(database);
    await dropDb(restoreDatabase);
    const after = await listRepDatabases();
    round.droppedClean = !after.includes(database) && !after.includes(restoreDatabase);
    round.finishedAt = new Date().toISOString();
    console.log(`  [r${n}] dropped ${database} + ${restoreDatabase} (clean=${round.droppedClean})`);
    rounds.push(round);
  }

  // --- cross-round analysis -----------------------------------------------------------------
  const gateIds = rounds[0].gates.map((g) => g.id);
  const matrix = {};
  const flakyGates = [];
  const countDrift = [];
  for (const id of gateIds) {
    const per = rounds.map((r) => r.gates.find((g) => g.id === id));
    matrix[id] = per.map((g) => g.status);
    if (new Set(matrix[id]).size > 1) flakyGates.push(id);
    const passCounts = per.map((g) => (g.counts ? g.counts.passed : null)).filter((v) => v !== null);
    if (passCounts.length > 0 && new Set(passCounts).size > 1) countDrift.push({ gate: id, passedPerRound: passCounts });
  }
  const allPass = rounds.every((r) => r.gates.every((g) => g.status === "PASS"));
  const residualClean = rounds.every((r) => r.residual.roundDbsAbsentBeforeCreate && r.droppedClean);
  const totalDurationMs = Date.now() - startedAt.getTime();

  const artifact = {
    task: "CRITICAL_GATE_REPEATABILITY_V1",
    phase: "AUTOMATED_PG16_RELEASE_GATE_V1",
    generatedAt: new Date().toISOString(),
    server: { host: baseParts.host, port: baseParts.port, postgresVersion: serverVersion },
    vitest: { fileParallelismDisabled },
    logsDir: workDir,
    rounds,
    analysis: {
      gateMatrix: matrix,
      flakyGateCount: flakyGates.length,
      flakyGates,
      testCountDriftAcrossRounds: countDrift,
      allGatesPassedAllRounds: allPass,
      residualStateClean: residualClean,
      totalDurationMs,
    },
  };
  mkdirSync(join(repoRoot, "artifacts", "ci"), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(`\n${"=".repeat(72)}`);
  console.log("  PER-ROUND MATRIX");
  console.log(`  ${"gate".padEnd(28)} r1      r2      r3`);
  for (const id of gateIds) {
    console.log(`  ${id.padEnd(28)} ${matrix[id].map((s) => s.padEnd(7)).join(" ")}`);
  }
  console.log("=".repeat(72));
  console.log(`  FLAKY_GATE count: ${flakyGates.length}${flakyGates.length ? ` — ${flakyGates.join(", ")}` : ""}`);
  if (countDrift.length > 0) console.log(`  test-count drift: ${JSON.stringify(countDrift)}`);
  console.log(`  residual state clean: ${residualClean}`);
  console.log(`  total runtime: ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  artifact: ${artifactPath} (local evidence — NOT committed)`);

  process.exitCode = allPass && flakyGates.length === 0 && residualClean ? 0 : 1;
}

main().catch((err) => {
  console.error(`repeatability: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
