/**
 * LOCAL_ENVIRONMENT_RUNTIME_V1 — clear local sanitized pilot data only.
 *
 * Requires an explicit confirmation token. This script refuses every database except the exact
 * loopback geoplane_local_runtime target and preserves schema_migrations.
 */
import { Pool } from "pg";
import {
  LOCAL_DATABASES,
  loadLocalEnvironment,
  parseLocalDatabaseUrl,
  providerRuntimeIsExplicitlyOff,
  sanitizedError,
} from "./runtime-lib.mjs";

const tokenArg = process.argv.find((arg) => arg.startsWith("--confirm="));
const tokenIndex = process.argv.indexOf("--confirm");
const confirmation = tokenArg?.slice("--confirm=".length) ?? (tokenIndex >= 0 ? process.argv[tokenIndex + 1] : null);
if (confirmation !== LOCAL_DATABASES.runtime.name) {
  console.error(`local:reset: confirmation required: --confirm ${LOCAL_DATABASES.runtime.name}`);
  process.exit(2);
}

const environment = loadLocalEnvironment();
if (!providerRuntimeIsExplicitlyOff(environment.resolveValue("PROVIDER_RUNTIME_ENABLED"))) {
  console.error("local:reset: PROVIDER_RUNTIME_ENABLED must be explicitly false.");
  process.exit(1);
}
const connectionString = environment.resolveValue(LOCAL_DATABASES.runtime.env);

try {
  parseLocalDatabaseUrl(connectionString, "runtime");
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const identity = await pool.query("SELECT current_database() AS database");
    if (identity.rows[0]?.database !== LOCAL_DATABASES.runtime.name) {
      throw new Error("connected database identity does not match the allowed local runtime target");
    }
    const tables = await pool.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
       ORDER BY tablename`,
    );
    await pool.query("BEGIN");
    try {
      if (tables.rows.length > 0) {
        const identifiers = tables.rows.map(({ tablename }) => `"public"."${String(tablename).replaceAll('"', '""')}"`);
        await pool.query(`TRUNCATE TABLE ${identifiers.join(", ")} RESTART IDENTITY CASCADE`);
      }
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    console.log(`local:reset: cleared sanitized pilot data from ${LOCAL_DATABASES.runtime.name}; migrations preserved.`);
  } finally {
    await pool.end().catch(() => undefined);
  }
} catch (error) {
  console.error(`local:reset: ${sanitizedError(error, environment)}`);
  process.exitCode = 1;
}
