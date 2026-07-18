/**
 * MIGRATION_REGISTRY_SINGLE_SOURCE_V1 — the .mjs reader for migrations/manifest.json, used by
 * scripts/preflight/preflight.mjs and scripts/backup/pg-verify.mjs. Kept behaviourally identical
 * to src/persistence/migration-manifest.ts; both read the SAME manifest.json (one source of truth).
 * The CLI scripts cannot import the .ts module at runtime, so this mirrors its readers.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VERSION_RE = /^\d{4}$/;

export function readMigrationManifest(migrationsDir) {
  return JSON.parse(readFileSync(join(migrationsDir, "manifest.json"), "utf8"));
}

export function requiredMigrationVersions(migrationsDir) {
  return readMigrationManifest(migrationsDir).migrations.map((m) => m.version);
}

export function highestRequiredMigrationVersion(migrationsDir) {
  const v = requiredMigrationVersions(migrationsDir);
  return v[v.length - 1] ?? "0000";
}

/** Same validation rules as the TS module; returns { ok, errors }. */
export function validateMigrationManifest(migrationsDir) {
  const errors = [];
  let manifest;
  try {
    manifest = readMigrationManifest(migrationsDir);
  } catch (err) {
    return { ok: false, errors: [`manifest.json unreadable: ${err.message}`] };
  }
  if (manifest.schemaVersion !== 1) errors.push(`unsupported schemaVersion ${manifest.schemaVersion}`);
  if (!Array.isArray(manifest.migrations)) return { ok: false, errors: [...errors, "migrations not an array"] };
  const versions = new Set();
  const filenames = new Set();
  let prev = "";
  for (const e of manifest.migrations) {
    if (!VERSION_RE.test(e.version)) errors.push(`version "${e.version}" not 4 digits`);
    if (versions.has(e.version)) errors.push(`duplicate version ${e.version}`);
    versions.add(e.version);
    if (filenames.has(e.filename)) errors.push(`duplicate filename ${e.filename}`);
    filenames.add(e.filename);
    if (!e.filename.startsWith(`${e.version}_`) || !e.filename.endsWith(".sql"))
      errors.push(`filename ${e.filename} != version prefix`);
    if (!existsSync(join(migrationsDir, e.filename))) errors.push(`missing file ${e.filename}`);
    if (prev !== "" && e.version <= prev) errors.push(`not strictly increasing at ${e.version}`);
    prev = e.version;
  }
  for (const f of readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f))) {
    if (!filenames.has(f)) errors.push(`migrations/${f} not registered`);
  }
  return { ok: errors.length === 0, errors };
}

/** Floor semantics: FAIL only if a required version is missing; ahead versions are tolerated. */
export function evaluateMigrationReadiness(appliedVersions, migrationsDir) {
  const required = requiredMigrationVersions(migrationsDir);
  const highestRequired = required[required.length - 1] ?? "0000";
  const missing = required.filter((v) => !appliedVersions.has(v));
  const ahead = [...appliedVersions].filter((v) => VERSION_RE.test(v) && v > highestRequired).sort();
  return {
    status: missing.length === 0 ? "PASS" : "FAIL",
    missing,
    ahead,
    databaseAheadOfBuild: ahead.length > 0,
    highestRequired,
  };
}
