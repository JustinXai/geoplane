/**
 * DatabaseEnvironmentPreflightV1 CLI (ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1).
 *
 *   node scripts/preflight/database-environment.mjs        # check all three database roles
 *   npm run preflight:db-env
 *
 * Verifies the three database environment roles:
 *   runtime — GEO_DATABASE_URL        local/staging runtime database
 *   test    — GEO_TEST_DATABASE_URL   automated-test database (tests TRUNCATE it freely)
 *   canary  — GEO_CANARY_DATABASE_URL isolated database dedicated to provider canary runs;
 *                                     must NEVER point at the runtime or test database.
 *
 * Checks per role: URL present · db NAME matches purpose · connectable · role privileges
 * appropriate (no superuser; test role can TRUNCATE) · migration ledger consistent with
 * migrations/manifest.json (expected latest version DERIVED from the manifest, never hardcoded).
 *
 * CLOSED error taxonomy: DATABASE_URL_MISSING · DATABASE_AUTH_FAILED · DATABASE_ROLE_INVALID ·
 * DATABASE_PURPOSE_MISMATCH · DATABASE_UNREACHABLE · DATABASE_MIGRATION_BEHIND.
 *
 * A .mjs cannot import the .ts at runtime, so the check logic mirrors
 * src/runtime/observability/database-environment-preflight.ts — same split as
 * scripts/preflight/preflight.mjs vs preflight.ts. KEEP THEM IN SYNC.
 *
 * Reads config from process.env, then a gitignored .env.local at repo root. NEVER prints a
 * secret value (no password, no full URL — only host/port/db-name/user shape facts).
 * Exits non-zero when any role FAILs.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { evaluateMigrationReadiness } from "../migration-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const migrationsDir = join(repoRoot, "migrations");

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

const ENV_VAR_BY_ROLE = {
  runtime: "GEO_DATABASE_URL",
  test: "GEO_TEST_DATABASE_URL",
  canary: "GEO_CANARY_DATABASE_URL",
};

// --- mirrored pure checks (keep in sync with database-environment-preflight.ts) ---

function describeDatabaseUrl(url) {
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    const dbName = u.pathname.replace(/^\//, "");
    if (dbName === "") return null;
    return { host: u.hostname, port: u.port === "" ? "5432" : u.port, dbName, user: decodeURIComponent(u.username) };
  } catch {
    return null;
  }
}

function sameDatabaseTarget(a, b) {
  return a.host === b.host && a.port === b.port && a.dbName === b.dbName;
}

function checkDatabasePurpose(role, shape, others) {
  const errors = [];
  const name = shape.dbName.toLowerCase();
  if (role === "test") {
    if (!name.includes("test")) {
      errors.push({ code: "DATABASE_PURPOSE_MISMATCH", detail: `test database name "${shape.dbName}" does not contain "test" — refusing a database that is not clearly throwaway (tests TRUNCATE it)` });
    }
  } else if (role === "canary") {
    if (!name.includes("canary")) {
      errors.push({ code: "DATABASE_PURPOSE_MISMATCH", detail: `canary database name "${shape.dbName}" does not contain "canary" — the canary requires its own clearly-labelled database` });
    }
    if (others.runtime && sameDatabaseTarget(shape, others.runtime)) {
      errors.push({ code: "DATABASE_PURPOSE_MISMATCH", detail: `canary URL points at the RUNTIME database (${shape.host}:${shape.port}/${shape.dbName}) — the canary must never touch the runtime database` });
    }
    if (others.test && sameDatabaseTarget(shape, others.test)) {
      errors.push({ code: "DATABASE_PURPOSE_MISMATCH", detail: `canary URL points at the TEST database (${shape.host}:${shape.port}/${shape.dbName}) — the canary must not share the automated-test database` });
    }
  } else if (name.includes("test") || name.includes("canary")) {
    errors.push({ code: "DATABASE_PURPOSE_MISMATCH", detail: `runtime database name "${shape.dbName}" looks like a test/canary database — the runtime role must point at the real local/staging database` });
  }
  return errors;
}

function classifyConnectionError(err) {
  const code = typeof err?.code === "string" ? err.code : "";
  const message = err instanceof Error ? err.message : String(err);
  if (code.startsWith("28")) return { code: "DATABASE_AUTH_FAILED", detail: "the server rejected the configured credential (auth failed)" };
  if (code === "42501") return { code: "DATABASE_ROLE_INVALID", detail: "the role is not permitted to connect to this database (permission denied)" };
  if (code === "3D000") return { code: "DATABASE_UNREACHABLE", detail: "the named database does not exist on the server" };
  if (/password/i.test(message) && code === "") return { code: "DATABASE_AUTH_FAILED", detail: "the server rejected the configured credential (auth failed)" };
  return { code: "DATABASE_UNREACHABLE", detail: "no usable connection to the server (network refused/timed out/unresolvable, or malformed URL)" };
}

async function checkRolePrivileges(db, role) {
  const errors = [];
  const su = await db.query("SELECT rolsuper AS is_super FROM pg_roles WHERE rolname = current_user");
  if (su.rows[0]?.is_super === true) {
    errors.push({ code: "DATABASE_ROLE_INVALID", detail: "connected as a SUPERUSER — use a dedicated least-privilege application role" });
  }
  if (role === "test") {
    const probe = await db.query(
      `SELECT to_regclass('public.organization') IS NOT NULL AS present,
              CASE WHEN to_regclass('public.organization') IS NOT NULL
                   THEN has_table_privilege(current_user, 'public.organization', 'TRUNCATE')
                   ELSE NULL END AS can_truncate`,
    );
    const row = probe.rows[0];
    if (row?.present === true && row.can_truncate !== true) {
      errors.push({ code: "DATABASE_ROLE_INVALID", detail: "the test-database role cannot TRUNCATE application tables — DB-backed tests require TRUNCATE" });
    }
  }
  return errors;
}

async function checkMigrationLedger(db) {
  let rows;
  try {
    rows = (await db.query("SELECT filename FROM schema_migrations")).rows;
  } catch (err) {
    // 42P01 undefined_table — ledger never created; anything else propagates for classification.
    if (err?.code !== "42P01") throw err;
    return [{ code: "DATABASE_MIGRATION_BEHIND", detail: "the schema_migrations ledger does not exist — no migration has been applied" }];
  }
  const applied = new Set(rows.map((r) => /^(\d{4})/.exec(r.filename)?.[1] ?? null).filter((v) => v !== null));
  const readiness = evaluateMigrationReadiness(applied, migrationsDir);
  if (readiness.status === "FAIL") {
    return [{ code: "DATABASE_MIGRATION_BEHIND", detail: `missing required migration version(s): ${readiness.missing.join(", ")} (manifest floor ${readiness.highestRequired})` }];
  }
  return [];
}

// --- main -------------------------------------------------------------------

const urls = {
  runtime: resolveVar(ENV_VAR_BY_ROLE.runtime),
  test: resolveVar(ENV_VAR_BY_ROLE.test),
  canary: resolveVar(ENV_VAR_BY_ROLE.canary),
};
const shapes = {
  runtime: urls.runtime ? describeDatabaseUrl(urls.runtime) : null,
  test: urls.test ? describeDatabaseUrl(urls.test) : null,
  canary: urls.canary ? describeDatabaseUrl(urls.canary) : null,
};

console.log("\nDatabaseEnvironmentPreflightV1 (runtime / test / canary)");
console.log("=".repeat(72));

const reports = [];
for (const role of ["runtime", "test", "canary"]) {
  const envVar = ENV_VAR_BY_ROLE[role];
  const url = urls[role];
  const errors = [];
  let dbName = null;

  if (!url) {
    errors.push({ code: "DATABASE_URL_MISSING", detail: `${envVar} is not set` });
  } else {
    const shape = shapes[role];
    if (!shape) {
      errors.push({ code: "DATABASE_UNREACHABLE", detail: `${envVar} is not a parseable postgres connection URL` });
    } else {
      dbName = shape.dbName;
      errors.push(...checkDatabasePurpose(role, shape, { runtime: shapes.runtime, test: shapes.test }));
      const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
      try {
        errors.push(...(await checkRolePrivileges(pool, role)));
        errors.push(...(await checkMigrationLedger(pool)));
      } catch (err) {
        errors.push(classifyConnectionError(err));
      } finally {
        await pool.end().catch(() => undefined);
      }
    }
  }

  const status = errors.length === 0 ? "PASS" : "FAIL";
  reports.push({ role, status });
  console.log(`  [${status}] ${role.padEnd(8)} ${envVar.padEnd(24)} db=${dbName ?? "(none)"}`);
  for (const e of errors) console.log(`         - ${e.code}: ${e.detail}`);
}

console.log("=".repeat(72));
const failed = reports.filter((r) => r.status === "FAIL");
if (failed.length > 0) {
  console.log(`RESULT: FAIL — role(s) not ready: ${failed.map((r) => r.role).join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("RESULT: PASS — all three database environment roles are ready.");
}
