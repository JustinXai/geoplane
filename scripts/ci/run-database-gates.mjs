/**
 * CI_REPRODUCIBLE_DATABASE_GATE_V1 (Agent C) — the database gate orchestrator.
 *
 *   node scripts/ci/run-database-gates.mjs
 *
 * Runs the full database gate battery against the three isolated CI databases
 * (provisioned by scripts/ci/create-isolated-databases.mjs) and writes the
 * per-gate PASS/FAIL/NOT_RUN result to artifacts/ci/database-gates.json.
 *
 * Steps (all REUSE existing tooling, nothing reimplemented):
 *   1. migrate runtime+test+canary to the manifest head via scripts/db/migrate.mjs
 *   2. manifest verify via scripts/migration-manifest.mjs
 *   3. DatabaseEnvironmentPreflightV1 via scripts/preflight/database-environment.mjs
 *   4. readiness (ledger vs manifest floor) per database over SQL
 *   5. the pg-backed vitest gate suites (spawned with GEO_TEST_DATABASE_URL and
 *      friends pointed at the CI databases), closed-pilot LAST so its sanitized
 *      data set remains in the CI test database for run-backup-restore-gate.mjs
 *   6. direct SQL spot-gates on the populated CI test database
 *      (constraints / triggers / appendOnly)
 *
 * Distinct named gates in the output: migrations, manifest, purposePreflight,
 * readiness, constraints, triggers, appendOnly, providerLedger,
 * concurrentIdempotency, tenantIsolation, agencyIsolation, restartE2E,
 * sessionRotationE2E, closedPilotE2E.
 *
 * HARD SAFETY: PROVIDER_RUNTIME_ENABLED is forced to "false" and
 * DEEPSEEK_API_KEY is REMOVED from every child environment (deleted unread), so
 * no real provider call is possible anywhere downstream. Passwords travel only
 * inside connection strings in child env vars — never printed, never argv.
 * NOT_RUN is reported as NOT_RUN, never PASS. Any gate != PASS exits non-zero.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { migrationsDir, repoRoot } from "../backup/pg-lib.mjs";
import {
  evaluateMigrationReadiness,
  requiredMigrationVersions,
  validateMigrationManifest,
} from "../migration-manifest.mjs";
import { CiGateError, resolveCiTopology } from "./create-isolated-databases.mjs";

const CHECKPOINT = "CI_REPRODUCIBLE_DATABASE_GATE_V1";
const PHASE = "AUTOMATED_PG16_RELEASE_GATE_V1";
const artifactsDir = join(repoRoot, "artifacts", "ci");
const GATES_JSON = join(artifactsDir, "database-gates.json");
const VITEST_JSON_A = join(artifactsDir, "vitest-gates-a.json");
const VITEST_JSON_B = join(artifactsDir, "vitest-gates-b.json");

// The pg-backed gate suites (run A), file paths relative to repo root.
const SUITES_RUN_A = [
  "tests/persistence/pg-tenancy-runtime.pg.test.ts",
  "tests/persistence/pg-tenancy-b2.pg.test.ts",
  "tests/e2e/core-runtime-e2e.pg.test.ts",
  "tests/e2e/product-http-e2e.pg.test.ts",
  "tests/pilot/pilot-acceptance.e2e.pg.test.ts",
  "tests/pilot/pilot-resilience.e2e.pg.test.ts",
  "tests/runtime/provider/provider-ledger.pg.test.ts",
  "tests/runtime/provider/provider-identity-migration.pg.test.ts",
];
// Run B: closed-pilot runs LAST and ALONE so its data set is what remains in
// the CI test database afterwards (run-backup-restore-gate.mjs depends on it).
const SUITES_RUN_B = ["tests/pilot/closed-pilot-operations.e2e.pg.test.ts"];

// --- child process plumbing -----------------------------------------------------------------

/** Child env: CI database URLs injected, provider runtime forced OFF, provider key stripped. */
function buildChildEnv(topology) {
  const env = { ...process.env };
  // HARD SAFETY: never read, never forward the real provider credential.
  delete env.DEEPSEEK_API_KEY;
  env.PROVIDER_RUNTIME_ENABLED = "false";
  env.GEO_DATABASE_URL = topology.urlFor("runtime");
  env.GEO_TEST_DATABASE_URL = topology.urlFor("test");
  env.GEO_CANARY_DATABASE_URL = topology.urlFor("canary");
  return env;
}

/** Spawn a step with live output; resolves the exit code (never throws on non-zero). */
function runStep(label, cmd, args, env) {
  console.log(`\n=== ${label} ===`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: repoRoot, env, stdio: "inherit", windowsHide: true });
    child.on("error", (err) => reject(new CiGateError("CI_DB_GATE_SPAWN_FAILED", `${label}: ${err.message}`)));
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

// --- vitest JSON evaluation -----------------------------------------------------------------

function readVitestJson(path, label) {
  if (!existsSync(path)) {
    throw new CiGateError("CI_DB_GATE_VITEST_OUTPUT_MISSING", `${label}: expected reporter output at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/** file (posix, repo-relative) -> [{ fullName, status }] from one or more vitest JSON reports. */
function indexVitestResults(reports) {
  const byFile = new Map();
  for (const report of reports) {
    for (const fileResult of report.testResults ?? []) {
      const normalized = String(fileResult.name ?? "").replace(/\\/g, "/");
      const key = SUITES_RUN_A.concat(SUITES_RUN_B).find((rel) => normalized.endsWith(rel)) ?? normalized;
      const tests = (fileResult.assertionResults ?? []).map((a) => ({
        fullName: String(a.fullName ?? a.title ?? ""),
        status: String(a.status ?? "unknown"),
      }));
      byFile.set(key, (byFile.get(key) ?? []).concat(tests));
    }
  }
  return byFile;
}

/**
 * Evaluate a gate over test selections [{ file, title? }]. FAIL if any matched
 * test failed; NOT_RUN if anything is missing/skipped or nothing ran; PASS only
 * when every matched test genuinely passed.
 */
function evaluateTestSelection(byFile, selections) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const missing = [];
  for (const sel of selections) {
    const tests = byFile.get(sel.file);
    if (!tests || tests.length === 0) {
      missing.push(sel.title ? `${sel.file} :: ${sel.title}` : sel.file);
      continue;
    }
    const matched = sel.title ? tests.filter((t) => t.fullName.includes(sel.title)) : tests;
    if (matched.length === 0) {
      missing.push(sel.title ? `${sel.file} :: ${sel.title}` : sel.file);
      continue;
    }
    for (const t of matched) {
      if (t.status === "passed") passed += 1;
      else if (t.status === "failed") failed += 1;
      else skipped += 1;
    }
  }
  if (failed > 0) return { status: "FAIL", detail: `${failed} failed, ${passed} passed, ${skipped} skipped` };
  if (missing.length > 0) return { status: "NOT_RUN", detail: `missing: ${missing.join("; ")}` };
  if (skipped > 0 || passed === 0) {
    return { status: "NOT_RUN", detail: `${skipped} skipped, ${passed} passed — suite did not fully run` };
  }
  return { status: "PASS", detail: `${passed} test(s) passed` };
}

// --- SQL helpers ----------------------------------------------------------------------------

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Run fn expecting a rejection; returns the Error, or null if it (wrongly) succeeded. */
async function expectReject(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

async function appliedVersions(pool) {
  try {
    const { rows } = await pool.query("SELECT filename FROM schema_migrations");
    return new Set(rows.map((r) => /^(\d{4})/.exec(r.filename)?.[1] ?? null).filter((v) => v !== null));
  } catch (err) {
    if (err?.code === "42P01") return new Set(); // ledger not created yet
    throw err;
  }
}

// --- main -----------------------------------------------------------------------------------

async function main() {
  const runStartedAt = new Date().toISOString();
  const topology = resolveCiTopology();
  const childEnv = buildChildEnv(topology);
  mkdirSync(artifactsDir, { recursive: true });

  const gates = {};
  const record = (name, status, detail) => {
    gates[name] = { status, detail };
    console.log(`GATE ${name.padEnd(22)} ${status}${detail ? ` — ${detail}` : ""}`);
  };

  const required = requiredMigrationVersions(migrationsDir);
  const highest = required[required.length - 1] ?? "0000";

  // ---- 1. migrations (scripts/db/migrate.mjs against all three roles) ----
  {
    const migrate = join(repoRoot, "scripts", "db", "migrate.mjs");
    const codes = {};
    codes.runtime = await runStep("migrate runtime", process.execPath, [migrate], childEnv);
    codes.test = await runStep("migrate test", process.execPath, [migrate, "--test"], childEnv);
    codes.canary = await runStep("migrate canary", process.execPath, [migrate, "--canary"], childEnv);

    const perDb = [];
    for (const role of ["runtime", "test", "canary"]) {
      const pool = new Pool({ connectionString: topology.urlFor(role), max: 1 });
      try {
        const present = await appliedVersions(pool);
        const missing = required.filter((v) => !present.has(v));
        perDb.push({ role, ok: codes[role] === 0 && missing.length === 0, missing });
      } finally {
        await pool.end().catch(() => undefined);
      }
    }
    const bad = perDb.filter((d) => !d.ok);
    record(
      "migrations",
      bad.length === 0 ? "PASS" : "FAIL",
      bad.length === 0
        ? `runtime+test+canary at ${highest} (${required.length} migrations each)`
        : bad.map((d) => `${d.role}: exit=${codes[d.role]} missing=[${d.missing.join(",")}]`).join("; "),
    );
  }

  // ---- 2. manifest ----
  {
    const res = validateMigrationManifest(migrationsDir);
    record("manifest", res.ok ? "PASS" : "FAIL", res.ok ? `manifest consistent, head ${highest}` : res.errors.join("; "));
  }

  // ---- 3. purpose preflight (all three roles must PASS) ----
  {
    const code = await runStep(
      "DatabaseEnvironmentPreflightV1",
      process.execPath,
      [join(repoRoot, "scripts", "preflight", "database-environment.mjs")],
      childEnv,
    );
    record("purposePreflight", code === 0 ? "PASS" : "FAIL", `preflight exit code ${code}`);
  }

  // ---- 4. readiness (ledger vs manifest floor, per database, over SQL) ----
  {
    const results = [];
    for (const role of ["runtime", "test", "canary"]) {
      const pool = new Pool({ connectionString: topology.urlFor(role), max: 1 });
      try {
        const readiness = evaluateMigrationReadiness(await appliedVersions(pool), migrationsDir);
        results.push({ role, status: readiness.status, missing: readiness.missing });
      } finally {
        await pool.end().catch(() => undefined);
      }
    }
    const bad = results.filter((r) => r.status !== "PASS");
    record(
      "readiness",
      bad.length === 0 ? "PASS" : "FAIL",
      bad.length === 0
        ? `all three ledgers at manifest floor ${highest}`
        : bad.map((r) => `${r.role} missing [${r.missing.join(",")}]`).join("; "),
    );
  }

  // ---- 5. the pg-backed vitest gate suites ----
  const vitestBin = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const vitestBase = ["run", "--no-file-parallelism", "--reporter=default", "--reporter=json"];
  const codeA = await runStep(
    "vitest gate suites (persistence / e2e / pilot / provider)",
    process.execPath,
    [vitestBin, ...vitestBase, `--outputFile.json=${VITEST_JSON_A}`, ...SUITES_RUN_A],
    childEnv,
  );
  const codeB = await runStep(
    "vitest closed-pilot operations (runs last; leaves the gate data set in place)",
    process.execPath,
    [vitestBin, ...vitestBase, `--outputFile.json=${VITEST_JSON_B}`, ...SUITES_RUN_B],
    childEnv,
  );

  const reportA = readVitestJson(VITEST_JSON_A, "vitest run A");
  const reportB = readVitestJson(VITEST_JSON_B, "vitest run B");
  const byFile = indexVitestResults([reportA, reportB]);

  record(
    "concurrentIdempotency",
    ...(() => {
      const r = evaluateTestSelection(byFile, [
        { file: "tests/persistence/pg-tenancy-runtime.pg.test.ts", title: "concurrent same-key creates" },
      ]);
      return [r.status, r.detail];
    })(),
  );
  {
    const r = evaluateTestSelection(byFile, [
      { file: "tests/persistence/pg-tenancy-runtime.pg.test.ts" },
      { file: "tests/persistence/pg-tenancy-b2.pg.test.ts" },
      { file: "tests/e2e/core-runtime-e2e.pg.test.ts" },
      { file: "tests/e2e/product-http-e2e.pg.test.ts" },
    ]);
    record("tenantIsolation", r.status, r.detail);
  }
  {
    const r = evaluateTestSelection(byFile, [
      { file: "tests/pilot/pilot-acceptance.e2e.pg.test.ts" },
      { file: "tests/persistence/pg-tenancy-b2.pg.test.ts", title: "authorizes an agency over a client" },
    ]);
    record("agencyIsolation", r.status, r.detail);
  }
  {
    const r = evaluateTestSelection(byFile, [
      { file: "tests/runtime/provider/provider-ledger.pg.test.ts" },
      { file: "tests/runtime/provider/provider-identity-migration.pg.test.ts" },
    ]);
    record("providerLedger", r.status, r.detail);
  }
  {
    const r = evaluateTestSelection(byFile, [
      { file: "tests/pilot/pilot-resilience.e2e.pg.test.ts", title: "(a) restart" },
    ]);
    record("restartE2E", r.status, r.detail);
  }
  {
    const r = evaluateTestSelection(byFile, [
      { file: "tests/pilot/pilot-resilience.e2e.pg.test.ts", title: "(b) rotation" },
    ]);
    record("sessionRotationE2E", r.status, r.detail);
  }
  {
    const r = evaluateTestSelection(byFile, [
      { file: "tests/pilot/closed-pilot-operations.e2e.pg.test.ts" },
    ]);
    record("closedPilotE2E", r.status, r.detail);
  }

  // ---- 6. direct SQL spot-gates on the (now populated) CI test database ----
  const testPool = new Pool({ connectionString: topology.urlFor("test"), max: 2 });
  let postgresVersion;
  let counts;
  try {
    postgresVersion = String((await testPool.query("SELECT version() AS v")).rows[0].v);

    // constraints: blank email + invalid organization type are both rejected.
    {
      const blankEmail = await expectReject(() => testPool.query(`INSERT INTO "user"(email) VALUES ('   ')`));
      const probe = await testPool.query(`INSERT INTO "user"(email) VALUES ($1) RETURNING id`, [
        `ci-gate+${Date.now()}@example.test`,
      ]);
      const badType = await expectReject(() =>
        testPool.query(
          `INSERT INTO organization(type, display_name, idempotency_key, created_by_user_id)
           VALUES ('NOT_A_TYPE', 'CI Gate Probe (Pilot Fixture)', $1, $2)`,
          [`ci-gate-${Date.now()}`, probe.rows[0].id],
        ),
      );
      const ok = blankEmail !== null && badType !== null;
      record(
        "constraints",
        ok ? "PASS" : "FAIL",
        ok ? "blank email + invalid organization type both rejected" : "a CHECK-constraint probe was NOT rejected",
      );
    }

    // triggers: knowledge_content is append-only (UPDATE and DELETE rejected).
    {
      const path = `knowledge/ci-gate/${Date.now()}`;
      const text = "ci-gate append-only probe · 世界";
      await testPool.query(
        `INSERT INTO knowledge_content(storage_path, content_hash, content_text) VALUES ($1, $2, $3)`,
        [path, sha256(text), text],
      );
      const upd = await expectReject(() =>
        testPool.query(`UPDATE knowledge_content SET content_text = 'x' WHERE storage_path = $1`, [path]),
      );
      const del = await expectReject(() =>
        testPool.query(`DELETE FROM knowledge_content WHERE storage_path = $1`, [path]),
      );
      const ok = upd !== null && del !== null;
      record(
        "triggers",
        ok ? "PASS" : "FAIL",
        ok ? "knowledge_content UPDATE + DELETE both rejected by trigger" : "an append-only trigger did NOT fire",
      );
    }

    // appendOnly: the provider_execution ledger row left by the closed-pilot
    // suite can be neither updated nor deleted.
    {
      const row = await testPool.query(`SELECT id FROM provider_execution ORDER BY created_at LIMIT 1`);
      if (row.rowCount === 0) {
        record(
          "appendOnly",
          "FAIL",
          "provider_execution is empty — the closed-pilot suite should have left exactly one ledger row to exercise",
        );
      } else {
        const id = row.rows[0].id;
        const upd = await expectReject(() =>
          testPool.query(`UPDATE provider_execution SET model = model WHERE id = $1`, [id]),
        );
        const del = await expectReject(() => testPool.query(`DELETE FROM provider_execution WHERE id = $1`, [id]));
        const ok =
          upd !== null && del !== null && /append-only/i.test(upd.message) && /append-only/i.test(del.message);
        record(
          "appendOnly",
          ok ? "PASS" : "FAIL",
          ok
            ? "provider_execution UPDATE + DELETE both rejected by the append-only triggers"
            : "provider_execution mutation was not rejected with the append-only trigger error",
        );
      }
    }

    // evidence counts (consumed by generate-ci-evidence.mjs)
    const migrationCount = Number(
      (await testPool.query(`SELECT count(*)::int AS n FROM schema_migrations`)).rows[0].n,
    );
    const tableCount = Number(
      (
        await testPool.query(
          `SELECT count(*)::int AS n FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
        )
      ).rows[0].n,
    );
    const constraintCount = Number(
      (
        await testPool.query(
          `SELECT count(*)::int AS n
             FROM pg_constraint c
             JOIN pg_class t ON c.conrelid = t.oid
             JOIN pg_namespace n ON t.relnamespace = n.oid
            WHERE n.nspname = 'public'`,
        )
      ).rows[0].n,
    );
    const triggerCount = Number(
      (
        await testPool.query(
          `SELECT count(*)::int AS n
             FROM pg_trigger tg
             JOIN pg_class t ON tg.tgrelid = t.oid
             JOIN pg_namespace n ON t.relnamespace = n.oid
            WHERE n.nspname = 'public' AND NOT tg.tgisinternal`,
        )
      ).rows[0].n,
    );
    counts = { migrationCount, tableCount, constraintCount, triggerCount };
  } finally {
    await testPool.end().catch(() => undefined);
  }

  // providerRuntimeEnabled as the children actually saw it (forced "false" above).
  const flagValue = String(childEnv.PROVIDER_RUNTIME_ENABLED ?? "").trim().toLowerCase();
  const providerRuntimeEnabled = flagValue === "true" || flagValue === "1";
  if (providerRuntimeEnabled) {
    throw new CiGateError("CI_DB_GATE_PROVIDER_FLAG", "PROVIDER_RUNTIME_ENABLED leaked into the gate run as enabled");
  }

  const summarize = (report) => ({
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
  });

  const output = {
    checkpoint: CHECKPOINT,
    phase: PHASE,
    generatedAt: new Date().toISOString(),
    runStartedAt,
    postgresVersion,
    counts,
    topology: {
      host: topology.admin.host,
      port: topology.admin.port,
      appRole: topology.appRole,
      runtimeDatabase: topology.databases.runtime,
      testDatabase: topology.databases.test,
      canaryDatabase: topology.databases.canary,
    },
    providerRuntimeEnabled,
    gates,
    vitest: {
      runA: { exitCode: codeA, files: SUITES_RUN_A, ...summarize(reportA) },
      runB: { exitCode: codeB, files: SUITES_RUN_B, ...summarize(reportB) },
    },
  };
  writeFileSync(GATES_JSON, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`\nrun-database-gates: wrote ${GATES_JSON}`);

  const notPass = Object.entries(gates).filter(([, g]) => g.status !== "PASS");
  const totalRan = (output.vitest.runA.total ?? 0) + (output.vitest.runB.total ?? 0);
  if (totalRan === 0) {
    throw new CiGateError("CI_DB_GATE_NO_TESTS_RAN", "the vitest gate suites executed zero tests");
  }
  if (codeA !== 0 || codeB !== 0) {
    throw new CiGateError(
      "CI_DB_GATE_SUITE_FAILURE",
      `vitest exited non-zero (runA=${codeA}, runB=${codeB}) — see suite output above`,
    );
  }
  if (notPass.length > 0) {
    throw new CiGateError(
      "CI_DB_GATE_NOT_PASS",
      notPass.map(([name, g]) => `${name}=${g.status}`).join(", "),
    );
  }
  console.log("run-database-gates: ALL GATES PASS.");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`run-database-gates: FAILED — ${msg}`);
  process.exit(1);
});
