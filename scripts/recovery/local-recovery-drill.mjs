/**
 * LOCAL_RECOVERY_DRILL_V1 — local-only backup/checksum/restore verification.
 *
 * This entry point intentionally has a narrower safety envelope than the generic backup tools:
 *   - LOCAL_ONLY_MODE must be TRUE and REMOTE_WRITE must be FORBIDDEN;
 *   - only GEO_TEST_DATABASE_URL is used, and its host must be loopback;
 *   - the source must be a dedicated geoplane_local_drill_source[_...] database;
 *   - the restore target is fixed to geoplane_local_restore_verify;
 *   - an existing target is never forced, dropped, or cleaned;
 *   - provider code is never imported or invoked (real provider calls by this drill = 0).
 *
 * The source is expected to have been prepared without copying customer data. The drill leaves the
 * restored database and checksummed dump in place for operator inspection. It never truncates or
 * mutates the source database.
 */
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  assertNotProtectedDb,
  assertSafeDbIdentifier,
  formatPgUrl,
  parseArgs,
  resolveConnection,
  runProcess,
  sha256File,
  withDatabase,
} from "../backup/pg-lib.mjs";

export const LOCAL_RESTORE_VERIFY_DB = "geoplane_local_restore_verify";
export const LOCAL_SOURCE_PATTERN = /^geoplane_local_drill_source(?:_[A-Za-z0-9]+)*$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const backupScript = join(repoRoot, "scripts", "backup", "backup.mjs");
const restoreScript = join(repoRoot, "scripts", "backup", "restore.mjs");

function requireExactEnv(name, expected) {
  const actual = process.env[name]?.trim();
  if (actual !== expected) {
    throw new Error(`${name} must be exactly ${expected}; refusing local recovery drill`);
  }
}

export function assertLocalDrillSafety({ sourceDatabase, targetDatabase, host }) {
  assertSafeDbIdentifier(sourceDatabase);
  assertSafeDbIdentifier(targetDatabase);
  assertNotProtectedDb(sourceDatabase, "use as local recovery drill source");
  assertNotProtectedDb(targetDatabase, "use as local recovery drill target");

  if (!LOCAL_SOURCE_PATTERN.test(sourceDatabase)) {
    throw new Error(
      `refusing source database "${sourceDatabase}": allowed local drill pattern is ` +
        "geoplane_local_drill_source[_suffix]",
    );
  }
  if (targetDatabase !== LOCAL_RESTORE_VERIFY_DB) {
    throw new Error(
      `refusing target database "${targetDatabase}": local drill target is fixed to ` +
        `"${LOCAL_RESTORE_VERIFY_DB}"`,
    );
  }
  if (sourceDatabase === targetDatabase) {
    throw new Error("local recovery drill source and target must be different databases");
  }
  if (!LOOPBACK_HOSTS.has(String(host).toLowerCase())) {
    throw new Error(`refusing non-loopback PostgreSQL host "${host}" in LOCAL_ONLY_MODE`);
  }
}

function parseEvidenceLine(output, prefix) {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`backup did not emit required ${prefix.trim()} evidence`);
  return line.slice(prefix.length).trim();
}

function providerCredentialFreeEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(?:OPENAI|PROVIDER|ANTHROPIC|GEMINI).*?(?:API_KEY|TOKEN|SECRET)$/i.test(name)) {
      delete env[name];
    }
  }
  env.PROVIDER_RUNTIME_ENABLED = "false";
  return env;
}

async function databaseSummary(parts) {
  const pool = new Pool({ connectionString: formatPgUrl(parts), max: 2 });
  try {
    const schema = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const migrations = await pool.query(
      `SELECT count(*)::int AS n FROM schema_migrations`,
    );
    const providerLedger = await pool.query(
      `SELECT CASE WHEN to_regclass('public.provider_execution') IS NULL THEN 0
                   ELSE (SELECT count(*)::int FROM provider_execution) END AS n`,
    );
    return {
      tables: schema.rows[0]?.n ?? 0,
      migrations: migrations.rows[0]?.n ?? 0,
      providerLedgerRows: providerLedger.rows[0]?.n ?? 0,
    };
  } finally {
    await pool.end();
  }
}

export async function runLocalRecoveryDrill(argv = process.argv.slice(2)) {
  requireExactEnv("LOCAL_ONLY_MODE", "TRUE");
  requireExactEnv("REMOTE_WRITE", "FORBIDDEN");

  const flags = parseArgs(argv);
  const sourceDatabase = typeof flags["source-db"] === "string" ? flags["source-db"] : "";
  const targetDatabase =
    typeof flags["target-db"] === "string" ? flags["target-db"] : LOCAL_RESTORE_VERIFY_DB;
  const user =
    typeof flags.user === "string"
      ? flags.user
      : process.env.GEO_PG_SUPERUSER?.trim() || "postgres";

  // Only the test connection is accepted. No --url flag is supported because a URL on argv could
  // expose credentials in a process listing.
  if (typeof flags.url === "string") {
    throw new Error("--url is forbidden; configure the local GEO_TEST_DATABASE_URL environment variable");
  }
  if (!sourceDatabase) {
    throw new Error("--source-db is required");
  }

  const source = resolveConnection({ test: true, db: sourceDatabase, user });
  if (!source) throw new Error("GEO_TEST_DATABASE_URL is required for the local recovery drill");
  assertLocalDrillSafety({ sourceDatabase, targetDatabase, host: source.host });

  const requestedOutDir = resolve(
    typeof flags.out === "string"
      ? flags.out
      : join(tmpdir(), "geoplane-local-recovery-drill"),
  );
  mkdirSync(requestedOutDir, { recursive: true });
  const outDir = realpathSync(requestedOutDir);
  const canonicalRepoRoot = realpathSync(repoRoot);
  const relativeToRepo = relative(canonicalRepoRoot, outDir);
  if (relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !isAbsolute(relativeToRepo))) {
    throw new Error("backup output directory must be outside the repository");
  }

  const target = withDatabase(source, targetDatabase);
  const maintenance = new Pool({ connectionString: formatPgUrl(withDatabase(source, "postgres")), max: 1 });
  try {
    const existing = await maintenance.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
      targetDatabase,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      throw new Error(
        `target database "${targetDatabase}" already exists; refusing to replace or clean it`,
      );
    }
  } finally {
    await maintenance.end();
  }

  const childEnv = providerCredentialFreeEnv();

  const backup = await runProcess(
    process.execPath,
    [backupScript, "--test", "--db", sourceDatabase, "--user", user, "--out", outDir],
    { env: childEnv },
  );
  const artifact = parseEvidenceLine(backup.stdout, "ARTIFACT ");
  const checksumLine = parseEvidenceLine(backup.stdout, "CHECKSUM sha256 ");
  if (!existsSync(artifact)) throw new Error("backup artifact reported by backup CLI does not exist");
  const recomputed = await sha256File(artifact);
  if (recomputed.toLowerCase() !== checksumLine.toLowerCase()) {
    throw new Error("backup checksum evidence does not match the artifact bytes");
  }

  const sidecar = `${artifact}.sha256`;
  writeFileSync(sidecar, `${recomputed}  ${basename(artifact)}\n`, { encoding: "utf8", flag: "wx" });

  const sourceSummary = await databaseSummary(source);
  const restore = await runProcess(
    process.execPath,
    [
      restoreScript,
      "--test",
      "--db",
      targetDatabase,
      "--user",
      user,
      "--dump",
      artifact,
      "--checksum",
      recomputed,
    ],
    { env: childEnv },
  );
  if (!restore.stdout.includes(`CHECKSUM_VERIFIED sha256 ${recomputed}`)) {
    throw new Error("restore did not confirm checksum verification");
  }

  const targetSummary = await databaseSummary(target);
  if (
    targetSummary.tables !== sourceSummary.tables ||
    targetSummary.migrations !== sourceSummary.migrations ||
    targetSummary.providerLedgerRows !== sourceSummary.providerLedgerRows
  ) {
    throw new Error(
      "restored database summary differs from source (tables, migrations, or historical provider ledger rows)",
    );
  }

  console.log(`ARTIFACT ${artifact}`);
  console.log(`CHECKSUM_FILE ${sidecar}`);
  console.log(`CHECKSUM_VERIFIED sha256 ${recomputed}`);
  console.log(
    `RESTORE_VERIFIED ${targetDatabase} tables=${targetSummary.tables} ` +
      `migrations=${targetSummary.migrations} provider_ledger_rows=${targetSummary.providerLedgerRows}`,
  );
  console.log("LOCAL_RECOVERY_DRILL_V1 PASS REAL_PROVIDER_CALLS=0 REMOTE_WRITE_ATTEMPTS=0");

  return { artifact, sidecar, checksum: recomputed, sourceSummary, targetSummary };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runLocalRecoveryDrill().catch((error) => {
    console.error(`local-recovery-drill: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
