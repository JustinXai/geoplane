/**
 * LOCAL_ENVIRONMENT_RUNTIME_V1 — shared, secret-safe local runtime plumbing.
 *
 * This module intentionally accepts only the three exact local database names and loopback
 * hosts. Callers must never log values returned by loadLocalEnvironment().
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredMigrationVersions } from "../migration-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const migrationsDir = join(repoRoot, "migrations");
export const stateDir = join(repoRoot, ".runtime", "local");
export const stateFile = join(stateDir, "app-state.json");
export const stdoutLog = join(stateDir, "app.stdout.log");
export const stderrLog = join(stateDir, "app.stderr.log");

export const LOCAL_DATABASES = Object.freeze({
  runtime: Object.freeze({ env: "GEO_DATABASE_URL", name: "geoplane_local_runtime" }),
  test: Object.freeze({ env: "GEO_TEST_DATABASE_URL", name: "geoplane_local_test" }),
  canary: Object.freeze({ env: "GEO_CANARY_DATABASE_URL", name: "geoplane_local_canary" }),
});
export const LOCAL_MIGRATIONS = Object.freeze(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SECRET_NAMES = [
  "GEO_DATABASE_URL",
  "GEO_TEST_DATABASE_URL",
  "GEO_CANARY_DATABASE_URL",
  "SESSION_SIGNING_KEY_CURRENT",
  "SESSION_SIGNING_KEY_PREVIOUS",
  "REVIEW_REFERENCE_KEY_CURRENT",
];

export function parseEnvFile(path = join(repoRoot, ".env.local")) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
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

export function loadLocalEnvironment() {
  const file = parseEnvFile();
  const merged = { ...file, ...process.env };
  const resolveValue = (name) => {
    const value = process.env[name] ?? file[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  return { merged, resolveValue };
}

export function parseLocalDatabaseUrl(value, role) {
  const expected = LOCAL_DATABASES[role];
  if (!expected) throw new Error(`unknown local database role: ${role}`);
  if (!value) throw new Error(`${expected.env} is missing`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${expected.env} is not a valid PostgreSQL URL`);
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error(`${expected.env} must use the PostgreSQL protocol`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`${expected.env} must use a loopback host in LOCAL_ONLY_MODE`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database !== expected.name) {
    throw new Error(`${expected.env} must target exactly ${expected.name}`);
  }
  return { role, env: expected.env, database, host, port: parsed.port || "5432" };
}

export function localPort(resolveValue = loadLocalEnvironment().resolveValue) {
  const raw = resolveValue("LOCAL_APP_PORT") ?? resolveValue("PORT") ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("LOCAL_APP_PORT must be an integer from 1024 through 65535");
  }
  return port;
}

export function sanitizedError(error, environment = loadLocalEnvironment()) {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[REDACTED_DATABASE_URL]");
  for (const name of SECRET_NAMES) {
    const secret = environment.resolveValue(name);
    if (secret) message = message.split(secret).join(`[REDACTED_${name}]`);
  }
  return message;
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readState() {
  if (!existsSync(stateFile)) return null;
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    if (!Number.isInteger(state.pid) || !Number.isInteger(state.port)) return null;
    return state;
  } catch {
    return null;
  }
}

export function writeState(state) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function nodeVersionCheck() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 20 || (major === 20 && minor >= 9);
}

function dependenciesCheck() {
  if (!existsSync(join(repoRoot, "node_modules"))) return false;
  try {
    const require = createRequire(import.meta.url);
    require.resolve("next/package.json");
    require.resolve("pg/package.json");
    return true;
  } catch {
    return false;
  }
}

async function portAvailable(port) {
  const { createServer } = await import("node:net");
  return await new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePromise(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

function diskFreeBytes() {
  const stats = statfsSync(repoRoot);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function databaseCheck(role, connectionString) {
  const expected = LOCAL_DATABASES[role];
  parseLocalDatabaseUrl(connectionString, role);
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const identity = await pool.query("SELECT current_database() AS database, inet_server_addr() AS address");
    if (identity.rows[0]?.database !== expected.name) {
      throw new Error(`${expected.env} connected to an unexpected database`);
    }
    const ledger = await pool.query("SELECT filename FROM schema_migrations");
    const applied = new Set(
      ledger.rows.map((row) => /^(\d{4})/.exec(String(row.filename))?.[1]).filter(Boolean),
    );
    const required = requiredMigrationVersions(migrationsDir);
    if (
      required.length !== LOCAL_MIGRATIONS.length ||
      required.some((version, index) => version !== LOCAL_MIGRATIONS[index])
    ) {
      throw new Error("migration manifest does not match the frozen local-stage range 0001-0008");
    }
    const missing = required.filter((version) => !applied.has(version));
    if (missing.length > 0) throw new Error(`${expected.name} is missing migration(s): ${missing.join(", ")}`);
    return { migrations: required.length };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export function databaseErrorDetail(error, role) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code.startsWith("28")) return `${LOCAL_DATABASES[role].name}: authentication failed`;
  if (code === "3D000") return `${LOCAL_DATABASES[role].name}: database does not exist`;
  if (code === "42P01") return `${LOCAL_DATABASES[role].name}: schema_migrations ledger is missing`;
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH"].includes(code)) {
    return `${LOCAL_DATABASES[role].name}: local PostgreSQL is unreachable`;
  }
  const message = error instanceof Error ? error.message : "";
  if (
    message.startsWith(`${LOCAL_DATABASES[role].env} `) ||
    message.startsWith(`${LOCAL_DATABASES[role].name} `) ||
    message.startsWith("migration manifest ")
  ) {
    return message;
  }
  return `${LOCAL_DATABASES[role].name}: readiness check failed${code ? ` (code ${code})` : ""}`;
}

export async function runPreflight({ emit = true } = {}) {
  const environment = loadLocalEnvironment();
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });

  record("node", nodeVersionCheck(), `Node ${process.versions.node}; required >= 20.9`);
  record("dependencies", dependenciesCheck(), "local Next.js and PostgreSQL packages installed");

  const urls = {};
  for (const role of Object.keys(LOCAL_DATABASES)) {
    const definition = LOCAL_DATABASES[role];
    const value = environment.resolveValue(definition.env);
    try {
      parseLocalDatabaseUrl(value, role);
      urls[role] = value;
      record(`database-purpose:${role}`, true, `${definition.env} -> ${definition.name} on loopback`);
    } catch (error) {
      record(`database-purpose:${role}`, false, sanitizedError(error, environment));
    }
  }

  for (const role of Object.keys(LOCAL_DATABASES)) {
    if (!urls[role]) continue;
    try {
      const result = await databaseCheck(role, urls[role]);
      record(`database-ready:${role}`, true, `connected; migrations 0001-0008 (${result.migrations}/${result.migrations})`);
    } catch (error) {
      record(`database-ready:${role}`, false, databaseErrorDetail(error, role));
    }
  }

  const sessionKey = environment.resolveValue("SESSION_SIGNING_KEY_CURRENT");
  const reviewKey = environment.resolveValue("REVIEW_REFERENCE_KEY_CURRENT");
  const usableKey = (value) =>
    Boolean(value && value.length >= 32 && !/(change[_-]?me|placeholder|example)/i.test(value));
  record(
    "session-signing-key",
    usableKey(sessionKey),
    usableKey(sessionKey)
      ? "present and usable (value hidden)"
      : "SESSION_SIGNING_KEY_CURRENT is missing, shorter than 32 characters, or a placeholder",
  );
  record(
    "review-reference-key",
    usableKey(reviewKey),
    usableKey(reviewKey)
      ? "present and usable (value hidden)"
      : "REVIEW_REFERENCE_KEY_CURRENT is missing, shorter than 32 characters, or a placeholder",
  );
  const providerValue = environment.resolveValue("PROVIDER_RUNTIME_ENABLED");
  record(
    "provider-runtime",
    providerValue?.toLowerCase() === "false",
    providerValue?.toLowerCase() === "false"
      ? "explicitly OFF"
      : "PROVIDER_RUNTIME_ENABLED must be explicitly false",
  );

  try {
    const port = localPort(environment.resolveValue);
    const state = readState();
    const owned = state?.port === port && isProcessAlive(state.pid);
    const available = owned || (await portAvailable(port));
    record("port", available, owned ? `127.0.0.1:${port} is held by the managed local app` : `127.0.0.1:${port} is available`);
  } catch (error) {
    record("port", false, sanitizedError(error, environment));
  }

  try {
    const free = diskFreeBytes();
    const minimum = 1024 ** 3;
    record("disk-space", free >= minimum, `${(free / 1024 ** 3).toFixed(1)} GiB free; required >= 1.0 GiB`);
  } catch (error) {
    record("disk-space", false, sanitizedError(error, environment));
  }

  if (emit) {
    console.log("LocalEnvironmentPreflightV1");
    for (const check of checks) console.log(`[${check.ok ? "PASS" : "FAIL"}] ${check.name}: ${check.detail}`);
    console.log(checks.every((check) => check.ok) ? "RESULT: PASS" : "RESULT: FAIL");
  }
  return { ok: checks.every((check) => check.ok), checks, environment };
}

export function spawnManaged(command, args, options = {}) {
  mkdirSync(stateDir, { recursive: true });
  const stdout = openSync(stdoutLog, "a", 0o600);
  const stderr = openSync(stderrLog, "a", 0o600);
  try {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: options.env,
      detached: true,
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    });
    child.unref();
    return child;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

export async function waitFor(predicate, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  return false;
}

export async function health(port, path, timeoutMs = 3000) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    return { ok: response.status === 200, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}
