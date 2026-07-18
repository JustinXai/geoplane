/**
 * Deployment preflight CLI for the staging runtime.
 *
 *   node scripts/preflight/preflight.mjs           # check the runtime DB (GEO_DATABASE_URL)
 *   node scripts/preflight/preflight.mjs --test    # check the throwaway test DB (GEO_TEST_DATABASE_URL)
 *   node scripts/preflight/preflight.mjs --prod     # hold to production strictness (weak signing key = BLOCKER)
 *
 * Runs the same six checks as src/runtime/observability/preflight.ts and GET /api/health/ready:
 *   environment · session-key · database · migrations · file-storage · provider-disabled
 *
 * A .mjs cannot import the .ts at runtime, so the check logic is re-implemented here — the same
 * split as scripts/db/migrate.mjs vs src/persistence/pg/migrator.ts. Keep EXPECTED_MIGRATION_VERSIONS
 * and the insecure-placeholder set in sync with the .ts.
 *
 * Reads config from process.env, then a gitignored .env.local at repo root. Never prints a secret
 * value (no DB URL, no signing-key material). Exits non-zero if any BLOCKER check FAILs.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const EXPECTED_MIGRATION_VERSIONS = ["0001", "0002", "0003", "0004", "0005", "0006"];
const CURRENT_MIGRATION_VERSION = "0006";
const MIN_PROD_SIGNING_KEY_LENGTH = 16;
const INSECURE_SESSION_KEY_PLACEHOLDERS = new Set([
  "change_me", "changeme", "change-me", "dev", "development", "insecure",
  "insecure-dev-key", "dev-insecure-placeholder", "placeholder", "secret",
  "test", "example", "changethis", "your-secret-key", "your-signing-key",
]);

// --- env resolution ---------------------------------------------------------

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const envFile = parseEnvFile(resolve(repoRoot, ".env.local"));
function resolveVar(name) {
  if (process.env[name] && process.env[name].trim() !== "") return process.env[name].trim();
  const fromFile = envFile[name];
  return fromFile && fromFile.trim() !== "" ? fromFile.trim() : null;
}

function versionPrefix(filename) {
  const m = /^(\d{4})/.exec(filename);
  return m ? m[1] : null;
}

// --- checks -----------------------------------------------------------------

function checkEnvironment(env) {
  const missing = [];
  if (!env.databaseUrl) missing.push(env.dbVarName);
  if (!env.sessionSigningKeyCurrent) missing.push("SESSION_SIGNING_KEY_CURRENT");
  return missing.length > 0
    ? { name: "environment", status: "FAIL", blocker: true, detail: `missing required env var(s): ${missing.join(", ")}` }
    : { name: "environment", status: "PASS", blocker: true, detail: "required env vars present (database URL, SESSION_SIGNING_KEY_CURRENT)" };
}

function checkSessionKey(env, prod) {
  const key = env.sessionSigningKeyCurrent;
  if (!key) return { name: "session-key", status: "FAIL", blocker: true, detail: "SESSION_SIGNING_KEY_CURRENT is missing" };
  const normalized = key.trim().toLowerCase();
  const insecure = INSECURE_SESSION_KEY_PLACEHOLDERS.has(normalized) || (prod && key.trim().length < MIN_PROD_SIGNING_KEY_LENGTH);
  if (insecure) {
    return prod
      ? { name: "session-key", status: "FAIL", blocker: true, detail: "SESSION_SIGNING_KEY_CURRENT is an insecure dev placeholder / too weak for a production run" }
      : { name: "session-key", status: "WARN", blocker: true, detail: "SESSION_SIGNING_KEY_CURRENT looks like a dev placeholder (acceptable outside production)" };
  }
  return { name: "session-key", status: "PASS", blocker: true, detail: "session signing key present" };
}

function checkProviderDisabled(env) {
  const raw = env.providerRuntimeEnabled;
  const enabled = raw !== null && ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
  return enabled
    ? { name: "provider-disabled", status: "WARN", blocker: false, detail: "PROVIDER_RUNTIME_ENABLED is true; the controlled provider must stay disabled in staging batch 1" }
    : { name: "provider-disabled", status: "PASS", blocker: false, detail: `provider runtime disabled (PROVIDER_RUNTIME_ENABLED=${raw === null ? "absent" : raw})` };
}

async function checkDatabaseConnection(pool) {
  if (!pool) return { name: "database", status: "FAIL", blocker: true, detail: "no database connection could be established (missing/invalid database URL)" };
  try {
    const { rows } = await pool.query("SELECT 1 AS ok");
    if (!rows[0] || rows[0].ok !== 1) return { name: "database", status: "FAIL", blocker: true, detail: "SELECT 1 did not return the expected result" };
    return { name: "database", status: "PASS", blocker: true, detail: "database reachable (SELECT 1 ok)" };
  } catch (err) {
    return { name: "database", status: "FAIL", blocker: true, detail: `database connection failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkMigrations(pool) {
  if (!pool) return { name: "migrations", status: "FAIL", blocker: true, detail: "no database connection to read the schema_migrations ledger" };
  try {
    const { rows } = await pool.query("SELECT filename FROM schema_migrations");
    const applied = new Set(rows.map((r) => versionPrefix(r.filename)).filter((v) => v !== null));
    const missing = EXPECTED_MIGRATION_VERSIONS.filter((v) => !applied.has(v));
    if (missing.length > 0) return { name: "migrations", status: "FAIL", blocker: true, detail: `missing migration version(s): ${missing.join(", ")} (need 0001-0006)` };
    const highest = [...applied].sort().at(-1) ?? "none";
    if (highest !== CURRENT_MIGRATION_VERSION) return { name: "migrations", status: "FAIL", blocker: true, detail: `schema version is ${highest}, expected current ${CURRENT_MIGRATION_VERSION}` };
    return { name: "migrations", status: "PASS", blocker: true, detail: `all ${EXPECTED_MIGRATION_VERSIONS.length} migrations applied (current ${CURRENT_MIGRATION_VERSION})` };
  } catch (err) {
    return { name: "migrations", status: "FAIL", blocker: true, detail: `could not read schema_migrations: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkFileStorage(pool) {
  if (!pool) return { name: "file-storage", status: "FAIL", blocker: true, detail: "no database connection to reach the knowledge_content store" };
  try {
    await pool.query("SELECT storage_path FROM knowledge_content LIMIT 0");
    return { name: "file-storage", status: "PASS", blocker: true, detail: "file storage reachable (knowledge_content table present)" };
  } catch (err) {
    return { name: "file-storage", status: "FAIL", blocker: true, detail: `knowledge_content store unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// --- main -------------------------------------------------------------------

const isTest = process.argv.includes("--test");
const prod = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const dbVarName = isTest ? "GEO_TEST_DATABASE_URL" : "GEO_DATABASE_URL";

const env = {
  dbVarName,
  databaseUrl: resolveVar(dbVarName),
  sessionSigningKeyCurrent: resolveVar("SESSION_SIGNING_KEY_CURRENT"),
  providerRuntimeEnabled: resolveVar("PROVIDER_RUNTIME_ENABLED"),
};

let pool = null;
if (env.databaseUrl) {
  pool = new Pool({ connectionString: env.databaseUrl, max: 2 });
}

try {
  const [database, migrations, fileStorage] = await Promise.all([
    checkDatabaseConnection(pool),
    checkMigrations(pool),
    checkFileStorage(pool),
  ]);
  const checks = [
    checkEnvironment(env),
    checkSessionKey(env, prod),
    database,
    migrations,
    fileStorage,
    checkProviderDisabled(env),
  ];

  const ICON = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL" };
  console.log(`\nDeployment preflight (target=${dbVarName}${prod ? ", prod strictness" : ""})`);
  console.log("=".repeat(72));
  for (const c of checks) {
    const tag = c.blocker ? "BLOCKER" : "advisory";
    console.log(`  [${ICON[c.status]}] ${c.name.padEnd(18)} (${tag}) — ${c.detail}`);
  }
  console.log("=".repeat(72));

  const blockingFailures = checks.filter((c) => c.blocker && c.status === "FAIL");
  const warnings = checks.filter((c) => c.status === "WARN" || (c.status === "FAIL" && !c.blocker));

  if (blockingFailures.length > 0) {
    console.log(`RESULT: FAIL — ${blockingFailures.length} blocking check(s) failed: ${blockingFailures.map((c) => c.name).join(", ")}`);
    process.exitCode = 1;
  } else if (warnings.length > 0) {
    console.log(`RESULT: PASS (with ${warnings.length} warning(s): ${warnings.map((c) => c.name).join(", ")})`);
  } else {
    console.log("RESULT: PASS — all checks green.");
  }
} finally {
  if (pool) await pool.end();
}
