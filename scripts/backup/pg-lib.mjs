/**
 * STAGING_OPERATIONS_V1 batch 2 (Agent E2) — shared plumbing for the backup/restore/verify CLIs.
 *
 * A .mjs cannot import the runtime .ts (same split as scripts/db/migrate.mjs vs
 * src/persistence/pg/migrator.ts), so connection resolution, the pg-tool locator and the
 * production-database guard live here and are shared by backup.mjs / restore.mjs / pg-verify.mjs.
 *
 * Secret hygiene: a database password is only ever passed to a child process through the
 * PGPASSWORD environment variable — it is NEVER placed on a command line (argv is visible in a
 * process listing) and NEVER printed. resolveConnection() returns the password in-memory only;
 * callers must not log the returned object verbatim.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IS_WIN = process.platform === "win32";
const here = dirname(fileURLToPath(import.meta.url));

/** Repo root = two levels up from scripts/backup (mirrors scripts/db/migrate.mjs). */
export const repoRoot = resolve(here, "..", "..");
export const migrationsDir = join(repoRoot, "migrations");

// --- env resolution (same minimal KEY=VALUE parser as migrate.mjs / config.ts) --------------

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

export function resolveVar(name) {
  if (process.env[name] && process.env[name].trim() !== "") return process.env[name].trim();
  const fromFile = envFile[name];
  return fromFile && fromFile.trim() !== "" ? fromFile.trim() : null;
}

// --- connection string parsing / formatting -------------------------------------------------

/** Parse a postgres URL into discrete parts. Password/user are URL-decoded. */
export function parsePgUrl(url) {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: u.password ? decodeURIComponent(u.password) : "",
    host: u.hostname || "localhost",
    port: u.port || "5432",
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
}

/** Rebuild a connection string from parts (percent-encoding user/password/db). */
export function formatPgUrl(parts) {
  const auth = `${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password)}`;
  return `postgresql://${auth}@${parts.host}:${parts.port}/${encodeURIComponent(parts.database)}`;
}

/** Return a copy of parts pointed at a different database (e.g. the 'postgres' maintenance db). */
export function withDatabase(parts, database) {
  return { ...parts, database };
}

// --- simple flag parsing --------------------------------------------------------------------

/** Parse `--flag value` / `--bool` argv into a map. Unknown tokens are ignored. */
export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const name = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i += 1;
    }
  }
  return flags;
}

/**
 * Resolve the connection to operate on, from flags + env, with overrides:
 *   base   = --url, else (--test ? GEO_TEST_DATABASE_URL : GEO_DATABASE_URL) from env/.env.local
 *   --db   overrides just the database name on that base
 *   --user overrides the connection role (password is KEPT from base — this is how the throwaway
 *          superuser-owned databases are reached: the 'postgres' role shares the .env password)
 *   --host/--port override host/port when present
 * Returns null when no base connection can be resolved.
 */
export function resolveConnection(flags) {
  let baseUrl = typeof flags.url === "string" ? flags.url : null;
  if (!baseUrl) {
    const varName = flags.test ? "GEO_TEST_DATABASE_URL" : "GEO_DATABASE_URL";
    baseUrl = resolveVar(varName);
  }
  if (!baseUrl) return null;

  const parts = parsePgUrl(baseUrl);
  if (typeof flags.db === "string") parts.database = flags.db;
  if (typeof flags.user === "string") parts.user = flags.user;
  if (typeof flags.host === "string") parts.host = flags.host;
  if (typeof flags.port === "string") parts.port = flags.port;
  return parts;
}

// --- production / recovery-source guard -----------------------------------------------------

/**
 * A database name that must NEVER be dumped-from or restored-into by these tools. Matches a
 * prod/production/prd/live token, and the recovery-source words, as a whole `_`/`-`-delimited
 * segment (so `geoplane_runtime`, `geoplane_pl_e`, `geoplane_bkp_src_*` are all allowed).
 */
export const PRODUCTION_DB_PATTERN =
  /(?:^|[_-])(prod|production|prd|live|recovery|recover|recovered)(?:[_-]|$)/i;

export function isProtectedDbName(name) {
  return PRODUCTION_DB_PATTERN.test(String(name ?? ""));
}

/** Throw if `name` looks like a production / recovery-source database. */
export function assertNotProtectedDb(name, action) {
  if (isProtectedDbName(name)) {
    throw new Error(
      `refusing to ${action} database "${name}": name matches the protected ` +
        `production/recovery pattern. This tool only operates on throwaway/staging databases.`,
    );
  }
}

/** A safe SQL identifier for CREATE/DROP DATABASE (no injection surface). */
export function assertSafeDbIdentifier(name) {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(String(name ?? ""))) {
    throw new Error(`unsafe database identifier: "${name}" (allowed: [A-Za-z0-9_], 1-63 chars)`);
  }
}

/**
 * Restore targets are an explicit allowlist of disposable/verification database names. This is
 * intentionally stricter than assertNotProtectedDb(): runtime, test, and canary role databases are
 * valid backup sources in some workflows, but must never be restore targets.
 */
const RESTORE_TARGET_PATTERNS = [
  /^geoplane_local_restore_verify$/,
  /^geoplane_bkp_dst_[A-Za-z0-9_]+$/,
  /^geoplane_pilot_rst_[A-Za-z0-9_]+$/,
  /^geoplane_cpops_rst_[A-Za-z0-9_]+$/,
  /^geoplane_ci_bkr_[A-Za-z0-9_]+$/,
  /^geoplane_pgverify_[A-Za-z0-9_]+$/,
  /^geoplane_rep_r[0-9]+_restore_test$/,
];

export function assertAllowedRestoreTarget(name) {
  const database = String(name ?? "");
  assertSafeDbIdentifier(database);
  assertNotProtectedDb(database, "restore into");
  if (!RESTORE_TARGET_PATTERNS.some((pattern) => pattern.test(database))) {
    throw new Error(
      `refusing to restore into database "${database}": target is not an allowlisted ` +
        "fresh restore-verification database (runtime/test/canary targets are forbidden)",
    );
  }
}

/** Validate a caller-supplied SHA-256 before it is used as restore evidence. */
export function assertSha256(value) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ""))) {
    throw new Error("invalid sha256 checksum: expected exactly 64 hexadecimal characters");
  }
}

/**
 * Verify a dump before any restore connection is opened. The expected digest is deliberately
 * passed as a plain checksum (not read from an untrusted artifact-side metadata file).
 */
export async function verifyFileSha256(path, expected) {
  assertSha256(expected);
  const actual = await sha256File(path);
  if (actual.toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`dump checksum mismatch: expected ${expected}, got ${actual}`);
  }
  return actual;
}

// --- pg client-tool location + invocation ---------------------------------------------------

/** Locate the directory holding pg_dump/pg_restore/psql, or null to fall back to PATH. */
export function locatePgBinDir() {
  const fromEnv = process.env.GEO_PG_BIN || process.env.PGBIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const probe = IS_WIN ? "pg_dump.exe" : "pg_dump";
  const bases = IS_WIN
    ? ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"]
    : ["/usr/lib/postgresql", "/usr/local/pgsql", "/usr/pgsql", "/opt/homebrew/opt"];
  for (const base of bases) {
    for (const v of ["18", "17", "16", "15", "14"]) {
      const dir = IS_WIN ? join(base, v, "bin") : join(base, v, "bin");
      if (existsSync(join(dir, probe))) return dir;
    }
  }
  return null;
}

/** Absolute path (or bare name via PATH) for a pg client tool. */
export function pgTool(name) {
  const dir = locatePgBinDir();
  const exe = IS_WIN ? `${name}.exe` : name;
  return dir ? join(dir, exe) : exe;
}

/** True when pg_dump AND pg_restore are actually invocable. */
export async function pgToolsAvailable() {
  try {
    await runProcess(pgTool("pg_dump"), ["--version"]);
    await runProcess(pgTool("pg_restore"), ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** The standard -U/-h/-p connection args every pg client tool shares (no db, no password). */
export function baseConnArgs(parts) {
  return ["-U", parts.user, "-h", parts.host, "-p", String(parts.port)];
}

/**
 * Spawn a child process, capturing stdout/stderr. The DB password is injected ONLY via
 * PGPASSWORD in the child env — never argv, never logged. Rejects on non-zero exit.
 */
export function runProcess(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const env = opts.env ? { ...opts.env } : { ...process.env };
    if (opts.password != null) env.PGPASSWORD = opts.password;
    const child = spawn(cmd, args, { cwd: opts.cwd, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ code, stdout, stderr });
      } else {
        const err = new Error(`${cmd} exited with code ${code}: ${stderr.trim() || stdout.trim()}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

// --- misc -----------------------------------------------------------------------------------

/** sha256 of a file's bytes, hex. */
export function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

/** A filesystem-safe UTC timestamp: 2026-07-18T12-30-00-000Z. */
export function fileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}
