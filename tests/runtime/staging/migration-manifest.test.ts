/**
 * MIGRATION_REGISTRY_SINGLE_SOURCE_V1 — validator + floor-semantics tests.
 * The real manifest must match the migrations/ directory; the validator must reject each
 * malformation; and readiness must use floor semantics (DB ahead of build is still ready).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsDir,
  evaluateMigrationReadiness,
  highestRequiredMigrationVersion,
  requiredMigrationVersions,
  validateMigrationManifest,
} from "../../../src/persistence/migration-manifest.js";

const realMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

/** Build a throwaway migrations dir with a manifest + the given sql filenames present on disk. */
function fixture(manifest: unknown, presentFiles: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "geo-manifest-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
  for (const f of presentFiles) writeFileSync(join(dir, f), "-- test\n", "utf8");
  return dir;
}
const created: string[] = [];
function make(manifest: unknown, files: readonly string[]): string {
  const d = fixture(manifest, files);
  created.push(d);
  return d;
}
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

const entry = (v: string, f: string) => ({ version: v, filename: f });
const good = {
  schemaVersion: 1,
  migrations: [entry("0001", "0001_a.sql"), entry("0002", "0002_b.sql")],
};

describe("validateMigrationManifest", () => {
  it("passes for the real migrations/manifest.json (matches the directory)", () => {
    const r = validateMigrationManifest(realMigrationsDir);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(requiredMigrationVersions(realMigrationsDir)).toEqual([
      "0001", "0002", "0003", "0004", "0005", "0006", "0007",
    ]);
    expect(highestRequiredMigrationVersion(realMigrationsDir)).toBe("0007");
  });

  it("passes for a well-formed fixture", () => {
    const dir = make(good, ["0001_a.sql", "0002_b.sql"]);
    expect(validateMigrationManifest(dir).ok).toBe(true);
  });

  it("FAILs when an on-disk migration is not registered (e.g. manifest missing 0007)", () => {
    const dir = make(good, ["0001_a.sql", "0002_b.sql", "0007_provider_ledger.sql"]);
    const r = validateMigrationManifest(dir);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("0007_provider_ledger.sql");
  });

  it("FAILs on a duplicate version", () => {
    const dir = make(
      { schemaVersion: 1, migrations: [entry("0001", "0001_a.sql"), entry("0001", "0001_b.sql")] },
      ["0001_a.sql", "0001_b.sql"],
    );
    expect(validateMigrationManifest(dir).errors.join(" ")).toContain("duplicate version");
  });

  it("FAILs when a manifest file does not exist on disk", () => {
    const dir = make(good, ["0001_a.sql"]); // 0002_b.sql missing on disk
    expect(validateMigrationManifest(dir).errors.join(" ")).toContain("does not exist");
  });

  it("FAILs on a non-4-digit version and on a version/filename prefix mismatch", () => {
    const dir = make(
      { schemaVersion: 1, migrations: [entry("1", "1_a.sql"), entry("0002", "0003_b.sql")] },
      ["1_a.sql", "0003_b.sql"],
    );
    const msg = validateMigrationManifest(dir).errors.join(" ");
    expect(msg).toContain("not a 4-digit");
    expect(msg).toContain("version prefix");
  });

  it("FAILs when versions are not strictly increasing", () => {
    const dir = make(
      { schemaVersion: 1, migrations: [entry("0002", "0002_a.sql"), entry("0001", "0001_b.sql")] },
      ["0002_a.sql", "0001_b.sql"],
    );
    expect(validateMigrationManifest(dir).errors.join(" ")).toContain("strictly increase");
  });
});

describe("evaluateMigrationReadiness (floor semantics)", () => {
  const all = new Set(["0001", "0002", "0003", "0004", "0005", "0006", "0007"]);

  it("PASSes when all required versions (0001-0007) are applied", () => {
    const r = evaluateMigrationReadiness(all, realMigrationsDir);
    expect(r.status).toBe("PASS");
    expect(r.databaseAheadOfBuild).toBe(false);
    expect(r.highestRequired).toBe("0007");
  });

  it("FAILs when the DB only has 0001-0006 (missing 0007)", () => {
    const r = evaluateMigrationReadiness(new Set(["0001", "0002", "0003", "0004", "0005", "0006"]), realMigrationsDir);
    expect(r.status).toBe("FAIL");
    expect(r.missing).toContain("0007");
  });

  it("FAILs when a middle version (0004) is missing", () => {
    const r = evaluateMigrationReadiness(new Set(["0001", "0002", "0003", "0005", "0006", "0007"]), realMigrationsDir);
    expect(r.status).toBe("FAIL");
    expect(r.missing).toContain("0004");
  });

  it("PASSes with DATABASE_AHEAD_OF_BUILD when the DB has 0001-0008", () => {
    const ahead = new Set([...all, "0008"]);
    const r = evaluateMigrationReadiness(ahead, realMigrationsDir);
    expect(r.status).toBe("PASS");
    expect(r.databaseAheadOfBuild).toBe(true);
    expect(r.ahead).toEqual(["0008"]);
  });
});
