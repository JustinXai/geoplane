/**
 * LOCAL_RECOVERY_DRILL_V1 — fail-closed safety checks that require no PostgreSQL server.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const drillScript = join(repoRoot, "scripts", "recovery", "local-recovery-drill.mjs");
const restoreScript = join(repoRoot, "scripts", "backup", "restore.mjs");
const localBackupScript = join(repoRoot, "scripts", "local", "backup.mjs");
const localRestoreScript = join(repoRoot, "scripts", "local", "restore-verify.mjs");
const tempDir = mkdtempSync(join(tmpdir(), "geoplane-local-recovery-safety-"));

function fakeTestUrl(host: string, database = "geoplane_test_control"): string {
  const url = new URL("postgresql://localhost");
  url.username = "local_test_role";
  url.password = "local_test_password";
  url.hostname = host;
  url.port = "5432";
  url.pathname = `/${database}`;
  return url.toString();
}

const safeEnv = {
  ...process.env,
  LOCAL_ONLY_MODE: "TRUE",
  REMOTE_WRITE: "FORBIDDEN",
  GEO_TEST_DATABASE_URL: fakeTestUrl("127.0.0.1"),
  GEO_DATABASE_URL: fakeTestUrl("127.0.0.1", "geoplane_local_runtime"),
};

function drill(args: string[], env: NodeJS.ProcessEnv = safeEnv) {
  return spawnSync(process.execPath, [drillScript, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("LOCAL_RECOVERY_DRILL_V1 safety envelope", () => {
  it("requires the explicit local-only gates before database resolution", () => {
    const result = drill(["--source-db", "geoplane_local_drill_source_safety"], {
      ...safeEnv,
      LOCAL_ONLY_MODE: "FALSE",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/LOCAL_ONLY_MODE must be exactly TRUE/i);
  });

  it("rejects runtime and other non-allowlisted source database names", () => {
    const result = drill(["--source-db", "geoplane_runtime"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/allowed local drill pattern/i);
  });

  it("rejects every restore target except geoplane_local_restore_verify", () => {
    const result = drill([
      "--source-db",
      "geoplane_local_drill_source_safety",
      "--target-db",
      "geoplane_local_restore_other",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/target is fixed to "geoplane_local_restore_verify"/i);
  });

  it("rejects a non-loopback database host before opening a connection", () => {
    const result = drill(["--source-db", "geoplane_local_drill_source_safety"], {
      ...safeEnv,
      GEO_TEST_DATABASE_URL: fakeTestUrl("db.example.test"),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/refusing non-loopback PostgreSQL host/i);
  });

  it("forbids a database URL on argv", () => {
    const result = drill([
      "--source-db",
      "geoplane_local_drill_source_safety",
      "--url",
      fakeTestUrl("127.0.0.1", "forbidden_argv"),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--url is forbidden/i);
  });

  it("refuses to place database dump evidence inside the repository", () => {
    const result = drill([
      "--source-db",
      "geoplane_local_drill_source_safety",
      "--out",
      repoRoot,
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/output directory must be outside the repository/i);
  });

  it("restore rejects a checksum mismatch before database resolution", () => {
    const dump = join(tempDir, "not-a-real.dump");
    writeFileSync(dump, "local-checksum-probe", "utf8");
    const wrong = createHash("sha256").update("different-bytes").digest("hex");
    const result = spawnSync(
      process.execPath,
      [restoreScript, "--dump", dump, "--checksum", wrong, "--db", "geoplane_local_restore_verify"],
      { cwd: repoRoot, env: safeEnv, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/checksum mismatch/i);
    expect(result.stderr).not.toContain(safeEnv.GEO_TEST_DATABASE_URL);
  });

  it.each([
    "geoplane_runtime",
    "geoplane_runtime_test",
    "geoplane_canary",
    "geoplane_local_runtime",
    "geoplane_local_test",
    "geoplane_local_canary",
    "geoplane_ci_runtime",
    "geoplane_ci_test",
    "geoplane_ci_canary",
  ])("generic restore rejects exact role database %s before connection", (database) => {
    const dump = join(tempDir, "guard-probe.dump");
    writeFileSync(dump, "guard-probe", "utf8");
    const checksum = createHash("sha256").update("guard-probe").digest("hex");
    const result = spawnSync(
      process.execPath,
      [restoreScript, "--dump", dump, "--checksum", checksum, "--db", database, "--force"],
      { cwd: repoRoot, env: safeEnv, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not an allowlisted fresh restore-verification database/i);
    expect(result.stderr).not.toMatch(/ECONNREFUSED|password authentication failed/i);
  });

  it("keeps the established disposable E2E restore-name families allowlisted", () => {
    const pgLibUrl = pathToFileURL(join(repoRoot, "scripts", "backup", "pg-lib.mjs")).href;
    const establishedTargets = [
      "geoplane_local_restore_verify",
      "geoplane_bkp_dst_123_probe",
      "geoplane_pilot_rst_123_probe",
      "geoplane_cpops_rst_123_probe",
      "geoplane_ci_bkr_123_probe",
      "geoplane_pgverify_123_probe",
      "geoplane_rep_r2_restore_test",
    ];
    const program =
      `import { assertAllowedRestoreTarget } from ${JSON.stringify(pgLibUrl)};` +
      `for (const name of ${JSON.stringify(establishedTargets)}) assertAllowedRestoreTarget(name);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("generic restore rejects --force even for the fixed verification target before connection", () => {
    const dump = join(tempDir, "force-probe.dump");
    writeFileSync(dump, "force-probe", "utf8");
    const checksum = createHash("sha256").update("force-probe").digest("hex");
    const result = spawnSync(
      process.execPath,
      [
        restoreScript,
        "--dump",
        dump,
        "--checksum",
        checksum,
        "--db",
        "geoplane_local_restore_verify",
        "--force",
      ],
      { cwd: repoRoot, env: safeEnv, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--force is forbidden/i);
    expect(result.stderr).not.toMatch(/ECONNREFUSED|password authentication failed/i);
  });

  it("generic restore forbids a connection URL on argv before reading a dump or connecting", () => {
    const result = spawnSync(
      process.execPath,
      [restoreScript, "--url", fakeTestUrl("127.0.0.1", "geoplane_local_restore_verify")],
      { cwd: repoRoot, env: safeEnv, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--url is forbidden for restore/i);
    expect(result.stderr).not.toMatch(/ECONNREFUSED|password authentication failed/i);
  });

  it("one-command backup rejects a non-exact runtime source before connection", () => {
    const result = spawnSync(process.execPath, [localBackupScript], {
      cwd: repoRoot,
      env: { ...safeEnv, GEO_DATABASE_URL: fakeTestUrl("127.0.0.1", "geoplane_runtime") },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/expected exact local database "geoplane_local_runtime"/i);
    expect(result.stderr).not.toMatch(/ECONNREFUSED|password authentication failed/i);
  });

  it("one-command backup rejects non-loopback runtime and repository output before connection", () => {
    const remote = spawnSync(process.execPath, [localBackupScript], {
      cwd: repoRoot,
      env: {
        ...safeEnv,
        GEO_DATABASE_URL: fakeTestUrl("db.example.test", "geoplane_local_runtime"),
      },
      encoding: "utf8",
    });
    expect(remote.status).not.toBe(0);
    expect(remote.stderr).toMatch(/refusing non-loopback PostgreSQL host/i);

    const inRepo = spawnSync(process.execPath, [localBackupScript, "--out", repoRoot], {
      cwd: repoRoot,
      env: safeEnv,
      encoding: "utf8",
    });
    expect(inRepo.status).not.toBe(0);
    expect(inRepo.stderr).toMatch(/evidence directory must be outside the repository/i);
    expect(inRepo.stderr).not.toMatch(/ECONNREFUSED|password authentication failed/i);
  });

  it("one-command restore forbids target and dump overrides before connection", () => {
    const result = spawnSync(
      process.execPath,
      [localRestoreScript, "--manifest", "unused", "--db", "geoplane_local_runtime"],
      { cwd: repoRoot, env: safeEnv, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/database\/force\/dump overrides are forbidden/i);
    expect(result.stderr).not.toMatch(/ECONNREFUSED|password authentication failed/i);
  });

  it("one-command restore without an override requires a prior local backup manifest", () => {
    const emptyBackupDir = mkdtempSync(join(tempDir, "empty-backups-"));
    const result = spawnSync(process.execPath, [localRestoreScript], {
      cwd: repoRoot,
      env: { ...safeEnv, LOCAL_BACKUP_DIR: emptyBackupDir },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/run npm run local:backup first/i);
    expect(result.stderr).not.toMatch(/ECONNREFUSED|password authentication failed/i);
  });

  it("one-command restore requires exact local runtime as its connection base before connection", () => {
    const artifact = join(tempDir, "local-wrapper.dump");
    writeFileSync(artifact, "local-wrapper", "utf8");
    const checksum = createHash("sha256").update("local-wrapper").digest("hex");
    const manifest = join(tempDir, "local-wrapper.manifest.json");
    writeFileSync(
      manifest,
      JSON.stringify({
        version: "LOCAL_RUNTIME_BACKUP_V1",
        sourceDatabase: "geoplane_local_runtime",
        artifact,
        checksumSha256: checksum,
        businessSummary: { summarySha256: checksum },
      }),
      "utf8",
    );
    const result = spawnSync(process.execPath, [localRestoreScript, "--manifest", manifest], {
      cwd: repoRoot,
      env: { ...safeEnv, GEO_DATABASE_URL: fakeTestUrl("127.0.0.1", "geoplane_runtime") },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/expected exact local database "geoplane_local_runtime"/i);
    expect(result.stderr).not.toMatch(/ECONNREFUSED|password authentication failed/i);
  });
});
