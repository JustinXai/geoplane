/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new pilot-phase file)
 * reconstruction_reason: MIGRATION_REGISTRY_SINGLE_SOURCE_V1 — one source of truth for the
 *   migration registry (migrations/manifest.json). preflight.ts, scripts/preflight/preflight.mjs
 *   and scripts/backup/pg-verify.mjs all read this manifest instead of each maintaining a version
 *   array, so the readiness/backup checks can never drift from the real migration set.
 * original_file_unavailable: n/a
 *
 * Readiness uses FLOOR semantics: a database missing any REQUIRED migration is not ready; a
 * database that has every required migration is ready; a database at a HIGHER-than-build version
 * is still ready (reported DATABASE_AHEAD_OF_BUILD) so a rolling deploy that migrates the DB first
 * does not flip every still-running old app instance to 503.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface MigrationManifestEntry {
  readonly version: string;
  readonly filename: string;
}

export interface MigrationManifest {
  readonly schemaVersion: number;
  readonly migrations: readonly MigrationManifestEntry[];
}

export interface ManifestValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export type ReadinessStatus = "PASS" | "FAIL";

export interface ReadinessEvaluation {
  readonly status: ReadinessStatus;
  /** Required versions absent from the database (FAIL when non-empty). */
  readonly missing: readonly string[];
  /** Applied versions higher than the build's highest required version. */
  readonly ahead: readonly string[];
  /** True when the DB is strictly ahead of the build (rolling-deploy tolerant). */
  readonly databaseAheadOfBuild: boolean;
  readonly highestRequired: string;
}

const VERSION_RE = /^\d{4}$/;

/** Default migrations directory: two levels up from src/persistence. */
export function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
}

export function readMigrationManifest(migrationsDir: string = defaultMigrationsDir()): MigrationManifest {
  const raw = readFileSync(join(migrationsDir, "manifest.json"), "utf8");
  const parsed = JSON.parse(raw) as MigrationManifest;
  return parsed;
}

/** The ordered REQUIRED version list from the manifest. */
export function requiredMigrationVersions(
  migrationsDir: string = defaultMigrationsDir(),
): readonly string[] {
  return readMigrationManifest(migrationsDir).migrations.map((m) => m.version);
}

export function highestRequiredMigrationVersion(
  migrationsDir: string = defaultMigrationsDir(),
): string {
  const versions = requiredMigrationVersions(migrationsDir);
  return versions[versions.length - 1] ?? "0000";
}

/**
 * Validates the manifest against its own rules AND the migrations/ directory:
 * 4-digit versions, unique versions + filenames, version==filename 4-digit prefix, every
 * manifest file exists on disk, every migrations/NNNN_*.sql on disk is registered, and versions
 * are strictly increasing.
 */
export function validateMigrationManifest(
  migrationsDir: string = defaultMigrationsDir(),
): ManifestValidationResult {
  const errors: string[] = [];
  let manifest: MigrationManifest;
  try {
    manifest = readMigrationManifest(migrationsDir);
  } catch (err) {
    return { ok: false, errors: [`manifest.json unreadable/unparseable: ${(err as Error).message}`] };
  }

  if (manifest.schemaVersion !== 1) {
    errors.push(`unsupported manifest schemaVersion: ${String(manifest.schemaVersion)}`);
  }
  if (!Array.isArray(manifest.migrations)) {
    return { ok: false, errors: [...errors, "manifest.migrations must be an array"] };
  }

  const seenVersions = new Set<string>();
  const seenFilenames = new Set<string>();
  let previous = "";
  for (const entry of manifest.migrations) {
    if (!VERSION_RE.test(entry.version)) {
      errors.push(`version "${entry.version}" is not a 4-digit string`);
    }
    if (seenVersions.has(entry.version)) errors.push(`duplicate version "${entry.version}"`);
    seenVersions.add(entry.version);
    if (seenFilenames.has(entry.filename)) errors.push(`duplicate filename "${entry.filename}"`);
    seenFilenames.add(entry.filename);
    if (!entry.filename.startsWith(`${entry.version}_`) || !entry.filename.endsWith(".sql")) {
      errors.push(`filename "${entry.filename}" does not match version prefix "${entry.version}_" + .sql`);
    }
    if (!existsSync(join(migrationsDir, entry.filename))) {
      errors.push(`manifest lists a file that does not exist: ${entry.filename}`);
    }
    if (previous !== "" && entry.version <= previous) {
      errors.push(`versions must strictly increase: "${entry.version}" after "${previous}"`);
    }
    previous = entry.version;
  }

  // Every real migration SQL file on disk must be registered.
  const onDisk = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f));
  for (const f of onDisk) {
    if (!seenFilenames.has(f)) errors.push(`migrations/${f} is not registered in manifest.json`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Floor-semantics readiness: given the set of applied migration versions (from
 * schema_migrations), decide readiness against the manifest's REQUIRED set.
 */
export function evaluateMigrationReadiness(
  appliedVersions: ReadonlySet<string>,
  migrationsDir: string = defaultMigrationsDir(),
): ReadinessEvaluation {
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
