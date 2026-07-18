/**
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1) — deployment PREFLIGHT checks.
 *
 * A set of small, individually testable readiness checks plus an orchestrator that runs them.
 * The SAME checks back three consumers:
 *   - the CLI at scripts/preflight/preflight.mjs (which re-implements the orchestration in plain
 *     JS because a .mjs cannot import this .ts at runtime — same split as scripts/db/migrate.mjs
 *     vs src/persistence/pg/migrator.ts; keep the EXPECTED_MIGRATION_VERSIONS list in sync),
 *   - the GET /api/health/ready route (src/app/api/health/ready/route.ts), and
 *   - the focused staging tests.
 *
 * Design rules honoured here:
 *   - Pure check functions take EXPLICIT inputs (resolved env, a Queryable) so tests need never
 *     mutate process.env or touch a real filesystem.
 *   - A check `detail` string is human-facing and MUST NEVER contain a secret value (no DB URL,
 *     no signing-key material). We report presence/shape, never contents.
 *   - Only imports from persistence/** (allowed) — never modifies it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatabaseConfig } from "../../persistence/config.js";
import type { Queryable } from "../../persistence/database-port.js";
import {
  evaluateMigrationReadiness,
  highestRequiredMigrationVersion,
  requiredMigrationVersions,
} from "../../persistence/migration-manifest.js";

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

export type PreflightStatus = "PASS" | "WARN" | "FAIL";

export interface PreflightCheckResult {
  /** Stable machine-ish name, e.g. "environment", "database", "migrations". */
  readonly name: string;
  readonly status: PreflightStatus;
  /** When true, a FAIL for this check blocks deployment / makes /ready return 503. */
  readonly blocker: boolean;
  /** Human-facing summary. NEVER contains a secret value. */
  readonly detail: string;
}

export interface PreflightReport {
  readonly checks: readonly PreflightCheckResult[];
  /** True when NO blocker check FAILed. A WARN or a non-blocker FAIL leaves ok true. */
  readonly ok: boolean;
  readonly hasWarnings: boolean;
}

/** A blocker FAIL is the only thing that makes the overall report not-ok. */
export function summarize(checks: readonly PreflightCheckResult[]): PreflightReport {
  const ok = checks.every((c) => !(c.blocker && c.status === "FAIL"));
  const hasWarnings = checks.some(
    (c) => c.status === "WARN" || (c.status === "FAIL" && !c.blocker),
  );
  return { checks, ok, hasWarnings };
}

// ---------------------------------------------------------------------------
// Resolved-environment inputs (no secrets are ever emitted downstream)
// ---------------------------------------------------------------------------

export interface PreflightEnv {
  /** GEO_DATABASE_URL (runtime) or GEO_TEST_DATABASE_URL (test) — value, or null when absent. */
  readonly databaseUrl: string | null;
  /** SESSION_SIGNING_KEY_CURRENT value, or null when absent. */
  readonly sessionSigningKeyCurrent: string | null;
  /** Raw PROVIDER_RUNTIME_ENABLED value, or null when absent. */
  readonly providerRuntimeEnabled: string | null;
}

/** Repo root = three levels up from src/runtime/observability. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Minimal KEY=VALUE reader mirroring src/persistence/config.ts precedence and quoting rules. */
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

/** process.env first, then a gitignored .env.local at repo root. Returns null when neither has it. */
function resolveEnvVar(name: string): string | null {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
  const fromFile = parseEnvFile(resolve(repoRoot(), ".env.local"))[name];
  if (fromFile && fromFile.trim() !== "") return fromFile.trim();
  return null;
}

/** Resolves the env the checks need. Uses loadDatabaseConfig for the DB URL (single source). */
export function readPreflightEnv(opts: { test?: boolean } = {}): PreflightEnv {
  const dbConfig = loadDatabaseConfig({ test: opts.test });
  return {
    databaseUrl: dbConfig?.connectionString ?? null,
    sessionSigningKeyCurrent: resolveEnvVar("SESSION_SIGNING_KEY_CURRENT"),
    providerRuntimeEnabled: resolveEnvVar("PROVIDER_RUNTIME_ENABLED"),
  };
}

/** True when this run should be held to production strictness (weak keys become blockers). */
export function isProductionRun(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

// ---------------------------------------------------------------------------
// Expected migrations — read from the SINGLE SOURCE OF TRUTH migrations/manifest.json
// (MIGRATION_REGISTRY_SINGLE_SOURCE_V1). This module, scripts/preflight/preflight.mjs and
// scripts/backup/pg-verify.mjs all consume the same manifest, so the readiness check can
// never drift from the real migration set. Readiness uses FLOOR semantics (see
// evaluateMigrationReadiness): a DB ahead of the build is still ready.
// ---------------------------------------------------------------------------

/** @deprecated retained for back-compat; prefer requiredMigrationVersions() from migration-manifest. */
export function readExpectedMigrationVersions(): readonly string[] {
  return requiredMigrationVersions();
}

export const EXPECTED_MIGRATION_VERSIONS: readonly string[] = requiredMigrationVersions();
export const CURRENT_MIGRATION_VERSION: string = highestRequiredMigrationVersion();

// ---------------------------------------------------------------------------
// Insecure signing-key placeholders (defence-in-depth; never a real key value)
// ---------------------------------------------------------------------------

const INSECURE_SESSION_KEY_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "change_me",
  "changeme",
  "change-me",
  "dev",
  "development",
  "insecure",
  "insecure-dev-key",
  "dev-insecure-placeholder",
  "placeholder",
  "secret",
  "test",
  "example",
  "changethis",
  "your-secret-key",
  "your-signing-key",
]);

const MIN_PROD_SIGNING_KEY_LENGTH = 16;

// ---------------------------------------------------------------------------
// Individual checks (pure over their inputs)
// ---------------------------------------------------------------------------

/** Required env vars are present: a database URL and SESSION_SIGNING_KEY_CURRENT. */
export function checkEnvironment(env: PreflightEnv): PreflightCheckResult {
  const missing: string[] = [];
  if (!env.databaseUrl) missing.push("GEO_DATABASE_URL");
  if (!env.sessionSigningKeyCurrent) missing.push("SESSION_SIGNING_KEY_CURRENT");
  if (missing.length > 0) {
    return {
      name: "environment",
      status: "FAIL",
      blocker: true,
      detail: `missing required env var(s): ${missing.join(", ")}`,
    };
  }
  return {
    name: "environment",
    status: "PASS",
    blocker: true,
    detail: "required env vars present (database URL, SESSION_SIGNING_KEY_CURRENT)",
  };
}

/** Session signing key present, and not an insecure dev placeholder in a production run. */
export function checkSessionKey(
  env: PreflightEnv,
  opts: { prod: boolean },
): PreflightCheckResult {
  const key = env.sessionSigningKeyCurrent;
  if (!key) {
    return {
      name: "session-key",
      status: "FAIL",
      blocker: true,
      detail: "SESSION_SIGNING_KEY_CURRENT is missing",
    };
  }
  const normalized = key.trim().toLowerCase();
  const looksInsecure =
    INSECURE_SESSION_KEY_PLACEHOLDERS.has(normalized) ||
    (opts.prod && key.trim().length < MIN_PROD_SIGNING_KEY_LENGTH);

  if (looksInsecure) {
    if (opts.prod) {
      return {
        name: "session-key",
        status: "FAIL",
        blocker: true,
        detail: "SESSION_SIGNING_KEY_CURRENT is an insecure dev placeholder / too weak for a production run",
      };
    }
    return {
      name: "session-key",
      status: "WARN",
      blocker: true,
      detail: "SESSION_SIGNING_KEY_CURRENT looks like a dev placeholder (acceptable outside production)",
    };
  }
  return {
    name: "session-key",
    status: "PASS",
    blocker: true,
    detail: "session signing key present",
  };
}

/** Provider runtime must stay disabled for staging batch 1 — WARN (never block) when enabled. */
export function checkProviderDisabled(env: PreflightEnv): PreflightCheckResult {
  const raw = env.providerRuntimeEnabled;
  const enabled =
    raw !== null && ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
  if (enabled) {
    return {
      name: "provider-disabled",
      status: "WARN",
      blocker: false,
      detail: "PROVIDER_RUNTIME_ENABLED is true; the controlled provider must stay disabled in staging batch 1",
    };
  }
  return {
    name: "provider-disabled",
    status: "PASS",
    blocker: false,
    detail: `provider runtime disabled (PROVIDER_RUNTIME_ENABLED=${raw === null ? "absent" : raw})`,
  };
}

/** Database is reachable: connect + SELECT 1. */
export async function checkDatabaseConnection(
  db: Queryable | null,
): Promise<PreflightCheckResult> {
  if (!db) {
    return {
      name: "database",
      status: "FAIL",
      blocker: true,
      detail: "no database connection could be established (missing/invalid database URL)",
    };
  }
  try {
    const res = await db.query<{ ok: number }>("SELECT 1 AS ok");
    const row = res.rows[0];
    if (!row || row.ok !== 1) {
      return {
        name: "database",
        status: "FAIL",
        blocker: true,
        detail: "SELECT 1 did not return the expected result",
      };
    }
    return {
      name: "database",
      status: "PASS",
      blocker: true,
      detail: "database reachable (SELECT 1 ok)",
    };
  } catch (err) {
    return {
      name: "database",
      status: "FAIL",
      blocker: true,
      detail: `database connection failed: ${errorSummary(err)}`,
    };
  }
}

/** All expected migrations (0001-0006) are recorded in the schema_migrations ledger. */
export async function checkMigrations(db: Queryable | null): Promise<PreflightCheckResult> {
  if (!db) {
    return {
      name: "migrations",
      status: "FAIL",
      blocker: true,
      detail: "no database connection to read the schema_migrations ledger",
    };
  }
  try {
    const res = await db.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const appliedVersions = new Set(
      res.rows
        .map((r) => versionPrefix(r.filename))
        .filter((v): v is string => v !== null),
    );
    // Floor semantics: FAIL only when a REQUIRED migration is missing; a database that is
    // AHEAD of the build's floor is still ready (rolling-deploy safe — a DB migrated ahead of
    // the running app instance does not flip that instance to 503).
    const readiness = evaluateMigrationReadiness(appliedVersions);
    if (readiness.status === "FAIL") {
      return {
        name: "migrations",
        status: "FAIL",
        blocker: true,
        detail: `missing required migration version(s): ${readiness.missing.join(", ")} (required floor ${readiness.highestRequired})`,
      };
    }
    const aheadNote = readiness.databaseAheadOfBuild
      ? ` — DATABASE_AHEAD_OF_BUILD (applied ahead: ${readiness.ahead.join(", ")}; tolerated)`
      : "";
    return {
      name: "migrations",
      status: "PASS",
      blocker: true,
      detail: `all ${requiredMigrationVersions().length} required migrations applied (current ${readiness.highestRequired})${aheadNote}`,
    };
  } catch (err) {
    return {
      name: "migrations",
      status: "FAIL",
      blocker: true,
      detail: `could not read schema_migrations: ${errorSummary(err)}`,
    };
  }
}

/** Configured file storage is reachable: the knowledge_content table answers a probe query. */
export async function checkFileStorage(db: Queryable | null): Promise<PreflightCheckResult> {
  if (!db) {
    return {
      name: "file-storage",
      status: "FAIL",
      blocker: true,
      detail: "no database connection to reach the knowledge_content store",
    };
  }
  try {
    // Existence + reachability probe; LIMIT 0 so we neither read tenant content nor depend on rows.
    await db.query("SELECT storage_path FROM knowledge_content LIMIT 0");
    return {
      name: "file-storage",
      status: "PASS",
      blocker: true,
      detail: "file storage reachable (knowledge_content table present)",
    };
  } catch (err) {
    return {
      name: "file-storage",
      status: "FAIL",
      blocker: true,
      detail: `knowledge_content store unreachable: ${errorSummary(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface PreflightInputs {
  readonly env: PreflightEnv;
  /** A live Queryable, or null when no database URL could be resolved. */
  readonly db: Queryable | null;
  readonly prod: boolean;
}

/** Runs every check and returns the ordered results. Never throws — a failure becomes a FAIL. */
export async function runPreflightChecks(
  inputs: PreflightInputs,
): Promise<PreflightCheckResult[]> {
  const { env, db, prod } = inputs;
  const [database, migrations, fileStorage] = await Promise.all([
    checkDatabaseConnection(db),
    checkMigrations(db),
    checkFileStorage(db),
  ]);
  return [
    checkEnvironment(env),
    checkSessionKey(env, { prod }),
    database,
    migrations,
    fileStorage,
    checkProviderDisabled(env),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts the leading 4-digit version from a migration filename, or null. */
export function versionPrefix(filename: string): string | null {
  const m = /^(\d{4})/.exec(filename);
  return m ? m[1]! : null;
}

/** A short, secret-free description of an unknown thrown value. */
function errorSummary(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
