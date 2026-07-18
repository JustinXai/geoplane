/**
 * CI_REPRODUCIBLE_DATABASE_GATE_V1 (Agent C) — final evidence merger.
 *
 *   node scripts/ci/generate-ci-evidence.mjs
 *
 * Merges the partial gate artifacts
 *   artifacts/ci/database-gates.json   (run-database-gates.mjs)
 *   artifacts/ci/backup-restore.json   (run-backup-restore-gate.mjs)
 * into artifacts/ci/postgres16-gate.json, and INDEPENDENTLY recomputes
 * realProviderCallsExecutedByCI by counting provider_execution rows across all
 * three CI databases whose model is a real model name (anything other than
 * 'offline-deterministic') created during this run (created_at >= the
 * orchestrator's runStartedAt). That count MUST be 0.
 *
 * Honesty rules: a gate that did not run is reported as NOT_RUN — never PASS.
 * The script exits non-zero when realProviderCallsExecutedByCI != 0, when any
 * gate is FAIL, or when any gate is NOT_RUN (an unproven gate cannot certify a
 * release). Failures carry a classified CI_EVIDENCE_* message.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { repoRoot } from "../backup/pg-lib.mjs";
import { CiGateError, resolveCiTopology } from "./create-isolated-databases.mjs";

const CHECKPOINT = "CI_REPRODUCIBLE_DATABASE_GATE_V1";
const PHASE = "AUTOMATED_PG16_RELEASE_GATE_V1";
const artifactsDir = join(repoRoot, "artifacts", "ci");
const GATES_JSON = join(artifactsDir, "database-gates.json");
const BACKUP_JSON = join(artifactsDir, "backup-restore.json");
const OUTPUT_JSON = join(artifactsDir, "postgres16-gate.json");

const OFFLINE_MODEL = "offline-deterministic";

const GATE_NAMES = [
  "migrations",
  "manifest",
  "purposePreflight",
  "readiness",
  "constraints",
  "triggers",
  "appendOnly",
  "providerLedger",
  "concurrentIdempotency",
  "tenantIsolation",
  "agencyIsolation",
  "restartE2E",
  "sessionRotationE2E",
  "closedPilotE2E",
];

function readJsonIfPresent(path, label) {
  if (!existsSync(path)) {
    console.error(`generate-ci-evidence: ${label} missing at ${path} — its gates are reported NOT_RUN.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new CiGateError("CI_EVIDENCE_ARTIFACT_UNREADABLE", `${label} at ${path} is not valid JSON: ${err.message}`);
  }
}

/**
 * Count provider_execution rows with a REAL model name (not the offline
 * deterministic marker) created during this run, across one CI database.
 */
async function countRealProviderCalls(url, sinceIso) {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const { rows } = sinceIso
      ? await pool.query(
          `SELECT count(*)::int AS n FROM provider_execution WHERE model <> $1 AND created_at >= $2`,
          [OFFLINE_MODEL, sinceIso],
        )
      : await pool.query(`SELECT count(*)::int AS n FROM provider_execution WHERE model <> $1`, [OFFLINE_MODEL]);
    return Number(rows[0].n);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function main() {
  const topology = resolveCiTopology();
  mkdirSync(artifactsDir, { recursive: true });

  const gatesJson = readJsonIfPresent(GATES_JSON, "database-gates.json");
  const backupJson = readJsonIfPresent(BACKUP_JSON, "backup-restore.json");

  const gateStatus = (name) => gatesJson?.gates?.[name]?.status ?? "NOT_RUN";
  const gates = {};
  for (const name of GATE_NAMES) {
    gates[name] = {
      status: gateStatus(name),
      detail: gatesJson?.gates?.[name]?.detail ?? "database-gates.json not present",
    };
  }

  // backup = the backup+checksum step; restore = restore AND its SQL read-back
  // (a restore whose read-back failed proves nothing and must not read PASS).
  const backupStatus = backupJson?.backup?.status ?? "NOT_RUN";
  const restoreStepStatus = backupJson?.restore?.status ?? "NOT_RUN";
  const readBackStatus = backupJson?.readBack?.status ?? "NOT_RUN";
  const restoreStatus =
    restoreStepStatus === "PASS" && readBackStatus === "PASS"
      ? "PASS"
      : restoreStepStatus === "NOT_RUN" && readBackStatus === "NOT_RUN"
        ? "NOT_RUN"
        : "FAIL";

  // Independently recomputed — never trusted from a prior artifact.
  const runStartedAt = typeof gatesJson?.runStartedAt === "string" ? gatesJson.runStartedAt : null;
  if (!runStartedAt) {
    console.error(
      "generate-ci-evidence: no runStartedAt available — counting ALL non-offline provider_execution rows (stricter).",
    );
  }
  let realProviderCallsExecutedByCI = 0;
  const perDatabaseRealCalls = {};
  for (const role of ["runtime", "test", "canary"]) {
    let n;
    try {
      n = await countRealProviderCalls(topology.urlFor(role), runStartedAt);
    } catch (err) {
      throw new CiGateError(
        "CI_EVIDENCE_DB_UNVERIFIABLE",
        `cannot count provider_execution rows in the CI ${role} database ` +
          `("${topology.databases[role]}"): ${err.message} — the no-real-provider-calls invariant is unverifiable`,
      );
    }
    perDatabaseRealCalls[topology.databases[role]] = n;
    realProviderCallsExecutedByCI += n;
  }

  const providerRuntimeEnabled = gatesJson?.providerRuntimeEnabled === true;

  const evidence = {
    checkpoint: CHECKPOINT,
    phase: PHASE,
    generatedAt: new Date().toISOString(),
    runStartedAt,
    // -- canonical server + schema facts --
    postgresVersion: gatesJson?.postgresVersion ?? null,
    migrationCount: gatesJson?.counts?.migrationCount ?? null,
    tableCount: gatesJson?.counts?.tableCount ?? null,
    constraintCount: gatesJson?.counts?.constraintCount ?? null,
    triggerCount: gatesJson?.counts?.triggerCount ?? null,
    // -- the three isolated CI databases --
    runtimeDatabase: topology.databases.runtime,
    testDatabase: topology.databases.test,
    canaryDatabase: topology.databases.canary,
    // -- gate statuses (flat, as required by the evidence contract) --
    tenantIsolation: gates.tenantIsolation.status,
    agencyIsolation: gates.agencyIsolation.status,
    providerLedger: gates.providerLedger.status,
    backup: backupStatus,
    restore: restoreStatus,
    restartE2E: gates.restartE2E.status,
    sessionRotationE2E: gates.sessionRotationE2E.status,
    closedPilotE2E: gates.closedPilotE2E.status,
    // -- provider-safety invariants --
    providerRuntimeEnabled,
    realProviderCallsExecutedByCI,
    perDatabaseRealCalls,
    // -- full detail --
    gates,
    backupRestore: backupJson,
    vitest: gatesJson?.vitest ?? null,
  };

  writeFileSync(OUTPUT_JSON, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`generate-ci-evidence: wrote ${OUTPUT_JSON}`);

  // ---- verdict ----
  const failures = [];
  for (const name of GATE_NAMES) {
    if (gates[name].status !== "PASS") failures.push(`${name}=${gates[name].status}`);
  }
  if (backupStatus !== "PASS") failures.push(`backup=${backupStatus}`);
  if (restoreStatus !== "PASS") failures.push(`restore=${restoreStatus}`);
  if (providerRuntimeEnabled) failures.push("providerRuntimeEnabled=true");
  if (realProviderCallsExecutedByCI !== 0) {
    failures.push(`realProviderCallsExecutedByCI=${realProviderCallsExecutedByCI}`);
  }

  console.log("\nPOSTGRES16 RELEASE GATE SUMMARY");
  console.log("=".repeat(72));
  console.log(`  postgresVersion              ${evidence.postgresVersion ?? "(unknown)"}`);
  console.log(
    `  databases                    runtime=${evidence.runtimeDatabase} test=${evidence.testDatabase} canary=${evidence.canaryDatabase}`,
  );
  for (const name of GATE_NAMES) console.log(`  ${name.padEnd(28)} ${gates[name].status}`);
  console.log(`  ${"backup".padEnd(28)} ${backupStatus}`);
  console.log(`  ${"restore".padEnd(28)} ${restoreStatus}`);
  console.log(`  ${"providerRuntimeEnabled".padEnd(28)} ${providerRuntimeEnabled}`);
  console.log(`  ${"realProviderCallsExecutedByCI".padEnd(28)} ${realProviderCallsExecutedByCI}`);
  console.log("=".repeat(72));

  if (failures.length > 0) {
    throw new CiGateError("CI_EVIDENCE_GATE_NOT_PASS", failures.join(", "));
  }
  console.log("generate-ci-evidence: RELEASE GATE PASS — all gates PASS, 0 real provider calls.");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`generate-ci-evidence: FAILED — ${msg}`);
  process.exit(1);
});
