/**
 * Standalone migration CLI for the core runtime.
 *
 *   node scripts/db/migrate.mjs            # apply to GEO_DATABASE_URL
 *   node scripts/db/migrate.mjs --test     # apply to GEO_TEST_DATABASE_URL
 *
 * Reads the connection string from process.env or a gitignored .env.local at repo root.
 * Never hardcodes a secret. Each migration file carries its own BEGIN/COMMIT, so it is
 * executed as a single multi-statement query; a schema_migrations ledger makes reruns
 * idempotent and rejects any post-application edit to a migration file.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const migrationsDir = join(repoRoot, "migrations");

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

function resolveUrl(name) {
  if (process.env[name] && process.env[name].trim() !== "") return process.env[name].trim();
  const fromFile = parseEnvFile(resolve(repoRoot, ".env.local"))[name];
  return fromFile && fromFile.trim() !== "" ? fromFile.trim() : null;
}

const isTest = process.argv.includes("--test");
const varName = isTest ? "GEO_TEST_DATABASE_URL" : "GEO_DATABASE_URL";
const connectionString = resolveUrl(varName);

if (!connectionString) {
  console.error(`migrate: ${varName} is not set (checked process.env and .env.local).`);
  process.exit(2);
}

const pool = new Pool({ connectionString });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let appliedCount = 0;

  for (const filename of files) {
    const sql = readFileSync(join(migrationsDir, filename), "utf8");
    const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
    const { rows } = await pool.query("SELECT checksum FROM schema_migrations WHERE filename = $1", [filename]);

    if (rows.length > 0) {
      if (rows[0].checksum !== checksum) {
        throw new Error(`Migration ${filename} was modified after being applied. Add a new file instead.`);
      }
      console.log(`skip   ${filename}`);
      continue;
    }

    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [filename, checksum]);
    console.log(`apply  ${filename}`);
    appliedCount += 1;
  }

  console.log(`migrate: done (${appliedCount} applied, target=${varName}).`);
} finally {
  await pool.end();
}
