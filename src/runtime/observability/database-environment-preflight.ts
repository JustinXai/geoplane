/**
 * ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1 (Agent C) — DatabaseEnvironmentPreflightV1.
 *
 * Verifies that the THREE database environment roles (see DatabaseEnvironmentRole in
 * src/persistence/config.ts) are each configured, reachable, pointed at a database whose NAME
 * matches the role's purpose, connected as an appropriately-privileged role, and migrated to the
 * floor defined by migrations/manifest.json (the single source of truth — the expected latest
 * version is DERIVED from the manifest, never hardcoded).
 *
 *   runtime — GEO_DATABASE_URL        local/staging runtime database
 *   test    — GEO_TEST_DATABASE_URL   automated-test database (tests TRUNCATE it freely)
 *   canary  — GEO_CANARY_DATABASE_URL isolated database dedicated to provider canary runs;
 *                                     must NEVER point at the runtime or test database
 *                                     (compared by host+port+dbname).
 *
 * CLOSED error taxonomy (every failure maps to exactly one of these codes):
 *   DATABASE_URL_MISSING      — the role's env var is unset/empty
 *   DATABASE_AUTH_FAILED      — the server rejected the credential
 *   DATABASE_ROLE_INVALID     — connected, but the role's privileges are inappropriate
 *   DATABASE_PURPOSE_MISMATCH — the URL points at a database that does not match the role's purpose
 *   DATABASE_UNREACHABLE      — no server answered (network/DNS/refused/missing database/bad URL)
 *   DATABASE_MIGRATION_BEHIND — schema_migrations is missing a version required by the manifest
 *
 * Design rules follow src/runtime/observability/preflight.ts:
 *   - Pure classification functions take EXPLICIT inputs so unit tests never touch process.env
 *     or a real server; the live connection is injected as a factory.
 *   - Every detail string is human-facing and MUST NEVER contain a secret (no password, no full
 *     URL). We report host/port/db-name/user shape facts only.
 *   - The CLI mirror is scripts/preflight/database-environment.mjs (same .ts/.mjs split as
 *     preflight.ts vs scripts/preflight/preflight.mjs — keep them in sync).
 */
import type { DatabaseEnvironmentRole } from "../../persistence/config.js";
import { databaseEnvVarName } from "../../persistence/config.js";
import type { Queryable } from "../../persistence/database-port.js";
import { evaluateMigrationReadiness } from "../../persistence/migration-manifest.js";

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

export type DatabaseEnvironmentErrorCode =
  | "DATABASE_URL_MISSING"
  | "DATABASE_AUTH_FAILED"
  | "DATABASE_ROLE_INVALID"
  | "DATABASE_PURPOSE_MISMATCH"
  | "DATABASE_UNREACHABLE"
  | "DATABASE_MIGRATION_BEHIND";

export interface DatabaseEnvironmentError {
  readonly code: DatabaseEnvironmentErrorCode;
  /** Human-facing summary. NEVER contains a secret value (no password, no full URL). */
  readonly detail: string;
}

export interface DatabaseRoleReport {
  readonly role: DatabaseEnvironmentRole;
  readonly envVar: string;
  /** Database name the URL points at, or null when the URL is absent/unparseable. */
  readonly dbName: string | null;
  readonly status: "PASS" | "FAIL";
  readonly errors: readonly DatabaseEnvironmentError[];
}

export interface DatabaseEnvironmentPreflightReport {
  readonly roles: readonly DatabaseRoleReport[];
  readonly ok: boolean;
}

// ---------------------------------------------------------------------------
// URL shape (secret-free projection of a connection string)
// ---------------------------------------------------------------------------

export interface DatabaseUrlShape {
  readonly host: string;
  readonly port: string;
  readonly dbName: string;
  readonly user: string;
}

/** Parses a connection URL into its secret-free shape. Returns null when unparseable. */
export function describeDatabaseUrl(url: string): DatabaseUrlShape | null {
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    const dbName = u.pathname.replace(/^\//, "");
    if (dbName === "") return null;
    return {
      host: u.hostname,
      port: u.port === "" ? "5432" : u.port,
      dbName,
      user: decodeURIComponent(u.username),
    };
  } catch {
    return null;
  }
}

/** True when two URLs point at the SAME physical database (host + port + dbname). */
export function sameDatabaseTarget(a: DatabaseUrlShape, b: DatabaseUrlShape): boolean {
  return a.host === b.host && a.port === b.port && a.dbName === b.dbName;
}

// ---------------------------------------------------------------------------
// Pure checks
// ---------------------------------------------------------------------------

/**
 * Purpose rules, all on NAME/TARGET shape (no connection needed):
 *  - test DB name must contain "test";
 *  - canary DB name must contain "canary", and its target must differ from BOTH the runtime and
 *    test targets (host+port+dbname);
 *  - runtime DB name must not look like a test/canary database.
 */
export function checkDatabasePurpose(
  role: DatabaseEnvironmentRole,
  shape: DatabaseUrlShape,
  others: { readonly runtime?: DatabaseUrlShape | null; readonly test?: DatabaseUrlShape | null },
): DatabaseEnvironmentError[] {
  const errors: DatabaseEnvironmentError[] = [];
  const name = shape.dbName.toLowerCase();
  if (role === "test") {
    if (!name.includes("test")) {
      errors.push({
        code: "DATABASE_PURPOSE_MISMATCH",
        detail: `test database name "${shape.dbName}" does not contain "test" — refusing a database that is not clearly throwaway (tests TRUNCATE it)`,
      });
    }
  } else if (role === "canary") {
    if (!name.includes("canary")) {
      errors.push({
        code: "DATABASE_PURPOSE_MISMATCH",
        detail: `canary database name "${shape.dbName}" does not contain "canary" — the canary requires its own clearly-labelled database`,
      });
    }
    if (others.runtime && sameDatabaseTarget(shape, others.runtime)) {
      errors.push({
        code: "DATABASE_PURPOSE_MISMATCH",
        detail: `canary URL points at the RUNTIME database (${shape.host}:${shape.port}/${shape.dbName}) — the canary must never touch the runtime database`,
      });
    }
    if (others.test && sameDatabaseTarget(shape, others.test)) {
      errors.push({
        code: "DATABASE_PURPOSE_MISMATCH",
        detail: `canary URL points at the TEST database (${shape.host}:${shape.port}/${shape.dbName}) — the canary must not share the automated-test database`,
      });
    }
  } else {
    if (name.includes("test") || name.includes("canary")) {
      errors.push({
        code: "DATABASE_PURPOSE_MISMATCH",
        detail: `runtime database name "${shape.dbName}" looks like a test/canary database — the runtime role must point at the real local/staging database`,
      });
    }
  }
  return errors;
}

/** Postgres error-code prefixes/classes → closed taxonomy. Pure over a thrown value. */
export function classifyConnectionError(err: unknown): DatabaseEnvironmentError {
  const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "";
  const message = err instanceof Error ? err.message : String(err);
  if (code.startsWith("28")) {
    // 28P01 invalid_password / 28000 invalid_authorization_specification
    return { code: "DATABASE_AUTH_FAILED", detail: "the server rejected the configured credential (auth failed)" };
  }
  if (code === "42501") {
    return { code: "DATABASE_ROLE_INVALID", detail: "the role is not permitted to connect to this database (permission denied)" };
  }
  if (code === "3D000") {
    return { code: "DATABASE_UNREACHABLE", detail: "the named database does not exist on the server" };
  }
  if (/password/i.test(message) && code === "") {
    // Driver-level auth failures that carry no SQLSTATE (e.g. SASL/SCRAM negotiation aborts).
    return { code: "DATABASE_AUTH_FAILED", detail: "the server rejected the configured credential (auth failed)" };
  }
  return {
    code: "DATABASE_UNREACHABLE",
    detail: "no usable connection to the server (network refused/timed out/unresolvable, or malformed URL)",
  };
}

// ---------------------------------------------------------------------------
// Connected checks (Queryable injected; unit tests use stubs)
// ---------------------------------------------------------------------------

/**
 * Role-privilege rules once connected:
 *  - the application role must NOT be a superuser (too broad for any of the three roles);
 *  - on the TEST database the role must be able to TRUNCATE application tables (probed via
 *    has_table_privilege on the tenancy-foundation `organization` table when it exists — if the
 *    table is absent the migration check reports DATABASE_MIGRATION_BEHIND instead).
 */
export async function checkRolePrivileges(
  db: Queryable,
  role: DatabaseEnvironmentRole,
): Promise<DatabaseEnvironmentError[]> {
  const errors: DatabaseEnvironmentError[] = [];
  const su = await db.query<{ is_super: boolean }>(
    "SELECT rolsuper AS is_super FROM pg_roles WHERE rolname = current_user",
  );
  if (su.rows[0]?.is_super === true) {
    errors.push({
      code: "DATABASE_ROLE_INVALID",
      detail: "connected as a SUPERUSER — use a dedicated least-privilege application role",
    });
  }
  if (role === "test") {
    const probe = await db.query<{ present: boolean; can_truncate: boolean | null }>(
      `SELECT to_regclass('public.organization') IS NOT NULL AS present,
              CASE WHEN to_regclass('public.organization') IS NOT NULL
                   THEN has_table_privilege(current_user, 'public.organization', 'TRUNCATE')
                   ELSE NULL END AS can_truncate`,
    );
    const row = probe.rows[0];
    if (row?.present === true && row.can_truncate !== true) {
      errors.push({
        code: "DATABASE_ROLE_INVALID",
        detail: "the test-database role cannot TRUNCATE application tables — DB-backed tests require TRUNCATE",
      });
    }
  }
  return errors;
}

/**
 * The schema_migrations ledger must contain every version required by migrations/manifest.json
 * (FLOOR semantics — a database AHEAD of the build is still consistent). The expected latest
 * version is derived from the manifest, so this check follows future migrations automatically.
 */
export async function checkMigrationLedger(db: Queryable): Promise<DatabaseEnvironmentError[]> {
  let rows: { filename: string }[];
  try {
    rows = (await db.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows;
  } catch (err) {
    // 42P01 undefined_table — the ledger has never been created; anything else (auth/network)
    // propagates to the caller for classification under the connection taxonomy.
    if ((err as { code?: unknown })?.code !== "42P01") throw err;
    return [
      {
        code: "DATABASE_MIGRATION_BEHIND",
        detail: "the schema_migrations ledger does not exist — no migration has been applied",
      },
    ];
  }
  const applied = new Set(
    rows
      .map((r) => /^(\d{4})/.exec(r.filename)?.[1] ?? null)
      .filter((v): v is string => v !== null),
  );
  const readiness = evaluateMigrationReadiness(applied);
  if (readiness.status === "FAIL") {
    return [
      {
        code: "DATABASE_MIGRATION_BEHIND",
        detail: `missing required migration version(s): ${readiness.missing.join(", ")} (manifest floor ${readiness.highestRequired})`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** A live connection plus its disposer; produced by the injected connect factory. */
export interface RoleConnection {
  readonly db: Queryable;
  close(): Promise<void>;
}

/** Connect factory — the production CLI passes a pg-backed one; unit tests pass stubs. */
export type DatabaseConnectFn = (connectionString: string) => Promise<RoleConnection>;

export interface DatabaseEnvironmentUrls {
  readonly runtime: string | null;
  readonly test: string | null;
  readonly canary: string | null;
}

const ROLE_ORDER: readonly DatabaseEnvironmentRole[] = ["runtime", "test", "canary"];

/** Runs every check for all three roles. Never throws — failures become coded errors. */
export async function runDatabaseEnvironmentPreflight(
  urls: DatabaseEnvironmentUrls,
  connect: DatabaseConnectFn,
): Promise<DatabaseEnvironmentPreflightReport> {
  const shapes: Record<DatabaseEnvironmentRole, DatabaseUrlShape | null> = {
    runtime: urls.runtime ? describeDatabaseUrl(urls.runtime) : null,
    test: urls.test ? describeDatabaseUrl(urls.test) : null,
    canary: urls.canary ? describeDatabaseUrl(urls.canary) : null,
  };

  const reports: DatabaseRoleReport[] = [];
  for (const role of ROLE_ORDER) {
    const envVar = databaseEnvVarName(role);
    const url = urls[role];
    const errors: DatabaseEnvironmentError[] = [];

    if (!url) {
      errors.push({ code: "DATABASE_URL_MISSING", detail: `${envVar} is not set` });
      reports.push({ role, envVar, dbName: null, status: "FAIL", errors });
      continue;
    }

    const shape = shapes[role];
    if (!shape) {
      errors.push({
        code: "DATABASE_UNREACHABLE",
        detail: `${envVar} is not a parseable postgres connection URL`,
      });
      reports.push({ role, envVar, dbName: null, status: "FAIL", errors });
      continue;
    }

    errors.push(...checkDatabasePurpose(role, shape, { runtime: shapes.runtime, test: shapes.test }));

    let conn: RoleConnection | null = null;
    try {
      conn = await connect(url);
    } catch (err) {
      errors.push(classifyConnectionError(err));
    }
    if (conn) {
      try {
        errors.push(...(await checkRolePrivileges(conn.db, role)));
        errors.push(...(await checkMigrationLedger(conn.db)));
      } catch (err) {
        errors.push(classifyConnectionError(err));
      } finally {
        await conn.close().catch(() => undefined);
      }
    }

    reports.push({
      role,
      envVar,
      dbName: shape.dbName,
      status: errors.length === 0 ? "PASS" : "FAIL",
      errors,
    });
  }

  return { roles: reports, ok: reports.every((r) => r.status === "PASS") };
}
