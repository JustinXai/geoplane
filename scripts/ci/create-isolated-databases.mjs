/**
 * CI_REPRODUCIBLE_DATABASE_GATE_V1 (Agent C) — isolated CI database provisioning.
 *
 *   node scripts/ci/create-isolated-databases.mjs
 *
 * Creates the THREE isolated CI databases (runtime / test / canary) plus one
 * dedicated NON-superuser application role that owns them, so the purpose
 * preflight (DatabaseEnvironmentPreflightV1) can PASS against them (it refuses
 * superuser connections). Idempotent: drop-if-exists then create.
 *
 * Environment (all optional except an admin connection):
 *   GEO_CI_ADMIN_URL      admin (superuser) connection URL. When unset, derived
 *                         from PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE),
 *                         and as a last resort from GEO_DATABASE_URL with the
 *                         'postgres' role (which shares the same password in the
 *                         local dev setup — same convention as scripts/backup).
 *   GEO_CI_RUNTIME_DB     default geoplane_ci_runtime
 *   GEO_CI_TEST_DB        default geoplane_ci_test    (MUST contain 'test')
 *   GEO_CI_CANARY_DB      default geoplane_ci_canary  (MUST contain 'canary')
 *   GEO_CI_APP_ROLE       default geoplane_ci_app     (non-superuser owner role)
 *   GEO_CI_APP_PASSWORD   default: the admin password (the closed-pilot suites
 *                         switch --user postgres keeping the base password, so
 *                         sharing the password preserves that proven pattern)
 *
 * HARD SAFETY:
 *   - refuses any database name matching the protected production/recovery
 *     pattern (reuses assertNotProtectedDb / PRODUCTION_DB_PATTERN from
 *     scripts/backup/pg-lib.mjs);
 *   - passwords live only in connection objects / SQL sent over the wire —
 *     they are NEVER printed and never placed on a command line;
 *   - no real provider call is possible from this script (it only talks SQL);
 *   - failures exit non-zero with a classified CI_DB_GATE_* message.
 */
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  assertNotProtectedDb,
  assertSafeDbIdentifier,
  formatPgUrl,
  parsePgUrl,
  resolveVar,
  withDatabase,
} from "../backup/pg-lib.mjs";

// --- shared CI topology (imported by the sibling scripts/ci/*.mjs scripts) ------------------

export const CI_DB_DEFAULTS = Object.freeze({
  runtime: "geoplane_ci_runtime",
  test: "geoplane_ci_test",
  canary: "geoplane_ci_canary",
});

export const CI_DB_ENV_VARS = Object.freeze({
  runtime: "GEO_CI_RUNTIME_DB",
  test: "GEO_CI_TEST_DB",
  canary: "GEO_CI_CANARY_DB",
});

/** Classified, non-secret failure. Every exit path names one of these codes. */
export class CiGateError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

function envOr(name, fallback) {
  const v = resolveVar(name);
  return v === null ? fallback : v;
}

/** Admin (superuser) connection parts. Never log the returned object verbatim. */
export function resolveAdminConnection() {
  const explicit = resolveVar("GEO_CI_ADMIN_URL");
  if (explicit) {
    const parts = parsePgUrl(explicit);
    if (!parts.database) parts.database = "postgres";
    return parts;
  }
  const pgPassword = process.env.PGPASSWORD;
  if (pgPassword && pgPassword.trim() !== "") {
    return {
      user: process.env.PGUSER && process.env.PGUSER.trim() !== "" ? process.env.PGUSER : "postgres",
      password: pgPassword,
      host: process.env.PGHOST && process.env.PGHOST.trim() !== "" ? process.env.PGHOST : "localhost",
      port: process.env.PGPORT && process.env.PGPORT.trim() !== "" ? process.env.PGPORT : "5432",
      database:
        process.env.PGDATABASE && process.env.PGDATABASE.trim() !== ""
          ? process.env.PGDATABASE
          : "postgres",
    };
  }
  const baseUrl = resolveVar("GEO_DATABASE_URL");
  if (baseUrl) {
    // Local-dev convention (scripts/backup/pg-lib.mjs): the 'postgres' superuser
    // role shares the application password, so keep the password and swap role+db.
    const parts = parsePgUrl(baseUrl);
    return { ...parts, user: "postgres", database: "postgres" };
  }
  throw new CiGateError(
    "CI_DB_GATE_ADMIN_UNRESOLVED",
    "no admin connection: set GEO_CI_ADMIN_URL, or PGPASSWORD (+ optional PGHOST/PGPORT/PGUSER/PGDATABASE), or GEO_DATABASE_URL",
  );
}

/** Validate one CI database name for its role (purpose + safety). */
function validateCiDbName(role, name) {
  assertSafeDbIdentifier(name);
  assertNotProtectedDb(name, `provision CI ${role} database as`);
  const lower = name.toLowerCase();
  if (role === "test" && !lower.includes("test")) {
    throw new CiGateError(
      "CI_DB_GATE_PURPOSE_MISMATCH",
      `CI test database name "${name}" must contain "test" (purpose preflight requires it)`,
    );
  }
  if (role === "canary" && !lower.includes("canary")) {
    throw new CiGateError(
      "CI_DB_GATE_PURPOSE_MISMATCH",
      `CI canary database name "${name}" must contain "canary" (purpose preflight requires it)`,
    );
  }
  if (role === "runtime" && (lower.includes("test") || lower.includes("canary"))) {
    throw new CiGateError(
      "CI_DB_GATE_PURPOSE_MISMATCH",
      `CI runtime database name "${name}" must NOT contain "test"/"canary" (purpose preflight rejects it)`,
    );
  }
}

/**
 * The full CI topology: admin connection, the three database names, and the
 * non-superuser application role + its connection URLs. Passwords stay inside
 * the returned object — callers must never print it verbatim.
 */
export function resolveCiTopology() {
  const admin = resolveAdminConnection();

  const databases = {
    runtime: envOr(CI_DB_ENV_VARS.runtime, CI_DB_DEFAULTS.runtime),
    test: envOr(CI_DB_ENV_VARS.test, CI_DB_DEFAULTS.test),
    canary: envOr(CI_DB_ENV_VARS.canary, CI_DB_DEFAULTS.canary),
  };
  for (const role of ["runtime", "test", "canary"]) validateCiDbName(role, databases[role]);
  const distinct = new Set(Object.values(databases));
  if (distinct.size !== 3) {
    throw new CiGateError(
      "CI_DB_GATE_PURPOSE_MISMATCH",
      `the three CI databases must be distinct (got ${Object.values(databases).join(", ")})`,
    );
  }
  if (Object.values(databases).includes(admin.database)) {
    throw new CiGateError(
      "CI_DB_GATE_PURPOSE_MISMATCH",
      "a CI database name collides with the admin maintenance database",
    );
  }

  const appRole = envOr("GEO_CI_APP_ROLE", "geoplane_ci_app");
  assertSafeDbIdentifier(appRole);
  if (appRole === admin.user) {
    throw new CiGateError(
      "CI_DB_GATE_ROLE_INVALID",
      `GEO_CI_APP_ROLE must not be the admin role ("${admin.user}") — the purpose preflight refuses superusers`,
    );
  }
  const appPassword = envOr("GEO_CI_APP_PASSWORD", admin.password);
  if (!appPassword) {
    throw new CiGateError(
      "CI_DB_GATE_ROLE_INVALID",
      "no application-role password available: set GEO_CI_APP_PASSWORD (or provide an admin password to inherit)",
    );
  }

  /** App-role connection string for one of the three CI databases. */
  const urlFor = (role) =>
    formatPgUrl({
      user: appRole,
      password: appPassword,
      host: admin.host,
      port: admin.port,
      database: databases[role],
    });

  return { admin, databases, appRole, appPassword, urlFor };
}

// --- provisioning ---------------------------------------------------------------------------

async function ensureAppRole(adminPool, appRole, appPassword) {
  // Password literal is SQL-escaped and sent only over the wire; statement
  // logging is suppressed for the transaction so the literal cannot land in a
  // server log either. It is never printed by this script.
  const passwordLiteral = `'${appPassword.replace(/'/g, "''")}'`;
  const existing = await adminPool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL log_statement = 'none'");
    if (existing.rowCount === 0) {
      await client.query(
        `CREATE ROLE "${appRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${passwordLiteral}`,
      );
    } else {
      await client.query(
        `ALTER ROLE "${appRole}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${passwordLiteral}`,
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new CiGateError(
      "CI_DB_GATE_ROLE_PROVISION_FAILED",
      `could not ${existing.rowCount === 0 ? "create" : "update"} role "${appRole}": ${err.message}`,
    );
  } finally {
    client.release();
  }
  return existing.rowCount === 0 ? "created" : "updated";
}

async function recreateDatabase(adminPool, name, owner) {
  // Guards re-asserted at the point of destruction, not only at resolve time.
  assertSafeDbIdentifier(name);
  assertNotProtectedDb(name, "drop and recreate");
  await adminPool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE "${name}" OWNER "${owner}"`);
}

async function main() {
  const topology = resolveCiTopology();
  const { admin, databases, appRole } = topology;

  const adminPool = new Pool({
    connectionString: formatPgUrl(admin),
    max: 2,
    connectionTimeoutMillis: 10_000,
  });

  try {
    let versionRow;
    try {
      versionRow = await adminPool.query("SELECT version() AS v");
    } catch (err) {
      throw new CiGateError(
        "CI_DB_GATE_ADMIN_UNREACHABLE",
        `cannot reach the admin server at ${admin.host}:${admin.port} as "${admin.user}": ${err.message}`,
      );
    }
    console.log(`create-isolated-databases: server = ${versionRow.rows[0].v}`);

    const roleAction = await ensureAppRole(adminPool, appRole, topology.appPassword);
    console.log(`create-isolated-databases: application role "${appRole}" ${roleAction} (non-superuser).`);

    for (const role of ["runtime", "test", "canary"]) {
      const name = databases[role];
      await recreateDatabase(adminPool, name, appRole);
      console.log(`create-isolated-databases: ${role.padEnd(7)} -> "${name}" (fresh, owner "${appRole}")`);
    }
  } finally {
    await adminPool.end().catch(() => undefined);
  }

  // Prove the app role can actually log in to each database (fail here, not mid-gate).
  for (const role of ["runtime", "test", "canary"]) {
    const probe = new Pool({ connectionString: topology.urlFor(role), max: 1, connectionTimeoutMillis: 10_000 });
    try {
      const who = await probe.query("SELECT current_user AS u, current_database() AS d");
      if (who.rows[0].u !== appRole) {
        throw new CiGateError(
          "CI_DB_GATE_ROLE_INVALID",
          `connected to "${who.rows[0].d}" as "${who.rows[0].u}", expected "${appRole}"`,
        );
      }
    } catch (err) {
      if (err instanceof CiGateError) throw err;
      throw new CiGateError(
        "CI_DB_GATE_ROLE_INVALID",
        `application role "${appRole}" cannot connect to the CI ${role} database: ${err.message}`,
      );
    } finally {
      await probe.end().catch(() => undefined);
    }
  }

  console.log(
    `CI_DATABASES runtime=${databases.runtime} test=${databases.test} canary=${databases.canary} role=${appRole}`,
  );
  console.log("create-isolated-databases: done.");
}

// Run main only when invoked directly (this module is also imported for resolveCiTopology).
const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase();

if (invokedDirectly) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`create-isolated-databases: FAILED — ${msg}`);
    process.exit(1);
  });
}
