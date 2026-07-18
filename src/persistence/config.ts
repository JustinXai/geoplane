/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 - resolves the
 *   database connection string for the runtime and the test suite WITHOUT ever committing a
 *   secret. Precedence: explicit process.env first, then a gitignored .env.local at repo root.
 *   Returns null (never throws) when no config is present, so DB-dependent tests can skip
 *   cleanly in an environment without Postgres instead of failing the whole suite.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DatabaseConfig {
  readonly connectionString: string;
}

/**
 * ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1 — the three database environment roles.
 *
 *  - "runtime": GEO_DATABASE_URL        — the local/staging runtime database (real application data;
 *                                          never TRUNCATEd by tests, never touched by the canary).
 *  - "test":    GEO_TEST_DATABASE_URL   — the automated-test database; DB-backed tests TRUNCATE it
 *                                          freely, so it must never point at real data.
 *  - "canary":  GEO_CANARY_DATABASE_URL — an isolated database dedicated to provider canary runs.
 *                                          It must NEVER point at the runtime or test database
 *                                          (compared by host+port+dbname), and the canary runner
 *                                          reads ONLY this variable (no fallback to the other two).
 */
export type DatabaseEnvironmentRole = "runtime" | "test" | "canary";

const ENV_VAR_BY_ROLE: Readonly<Record<DatabaseEnvironmentRole, string>> = {
  runtime: "GEO_DATABASE_URL",
  test: "GEO_TEST_DATABASE_URL",
  canary: "GEO_CANARY_DATABASE_URL",
};

/** The env var carrying the connection string for a database environment role. */
export function databaseEnvVarName(role: DatabaseEnvironmentRole): string {
  return ENV_VAR_BY_ROLE[role];
}

const RUNTIME_ENV_VAR = ENV_VAR_BY_ROLE.runtime;
const TEST_ENV_VAR = ENV_VAR_BY_ROLE.test;

/** Repo root = two levels up from src/persistence. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Minimal KEY=VALUE parser - no interpolation, no export keyword, quotes trimmed. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function resolveVar(name: string): string | null {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
  const fromFile = parseEnvFile(resolve(repoRoot(), ".env.local"))[name];
  if (fromFile && fromFile.trim() !== "") return fromFile.trim();
  return null;
}

/**
 * @param opts.test  when true, resolves the TEST database URL (GEO_TEST_DATABASE_URL),
 *                    which must point at a throwaway database - callers TRUNCATE it freely.
 */
export function loadDatabaseConfig(opts: { test?: boolean } = {}): DatabaseConfig | null {
  const url = resolveVar(opts.test ? TEST_ENV_VAR : RUNTIME_ENV_VAR);
  return url ? { connectionString: url } : null;
}

/**
 * Resolves the connection string for one of the three database environment roles
 * (see DatabaseEnvironmentRole). Same precedence as loadDatabaseConfig: explicit
 * process.env first, then the gitignored .env.local. Returns null when unset.
 */
export function loadDatabaseConfigForRole(role: DatabaseEnvironmentRole): DatabaseConfig | null {
  const url = resolveVar(ENV_VAR_BY_ROLE[role]);
  return url ? { connectionString: url } : null;
}
