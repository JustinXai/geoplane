/**
 * LOCAL_RECOVERY_DRILL_V1 — fail-closed safety checks that require no PostgreSQL server.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const drillScript = join(repoRoot, "scripts", "recovery", "local-recovery-drill.mjs");
const restoreScript = join(repoRoot, "scripts", "backup", "restore.mjs");
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
});
