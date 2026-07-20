/**
 * Preflight: verify git HEAD matches runtime Build Info SHA
 * Run before starting dev server or build to prevent version drift.
 * 
 * Modes:
 *   --configured  Check Git HEAD vs GEO_BUILD_GIT_SHA (build-time check)
 *   --runtime      Check Git HEAD vs Runtime Build Info API (runtime check)
 *   (default)      Same as --configured
 * 
 * Exit codes:
 *   0 - PASS, versions aligned
 *   1 - FAIL, version mismatch detected
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = args.includes("--runtime") ? "runtime" : "configured";
const BASE_URL = process.env.UI_TRUTH_BASE_URL ?? "http://localhost:3000";

function readEnvFile(envPath) {
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

const WORKTREE_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const GIT_HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: WORKTREE_ROOT, encoding: "utf8" }).trim();

const envPath = `${WORKTREE_ROOT}/.env.local`;
const env = readEnvFile(envPath);
const configuredSha = env.GEO_BUILD_GIT_SHA?.trim();

if (mode === "configured") {
  if (!configuredSha || configuredSha === "unknown" || configuredSha === "") {
    console.error("RUNTIME_BUILD_SHA_MISMATCH");
    console.error("Configured Build SHA (GEO_BUILD_GIT_SHA) not found or invalid in .env.local");
    console.error(`Git HEAD: ${GIT_HEAD}`);
    process.exit(1);
  }

  if (configuredSha !== GIT_HEAD) {
    console.error("RUNTIME_BUILD_SHA_MISMATCH");
    console.error(`Git HEAD:           ${GIT_HEAD}`);
    console.error(`Configured SHA:     ${configuredSha}`);
    process.exit(1);
  }

  console.log(`Preflight PASS [configured]`);
  console.log(`  Git HEAD:         ${GIT_HEAD}`);
  console.log(`  Configured SHA:   ${configuredSha}`);
  process.exit(0);
}

if (mode === "runtime") {
  const configuredStatus = configuredSha && configuredSha !== "unknown" && configuredSha !== ""
    ? (configuredSha === GIT_HEAD ? "MATCH" : "MISMATCH")
    : "NOT_CONFIGURED";

  try {
    const response = await fetch(`${BASE_URL}/api/ops/build-info`, {
      headers: { origin: BASE_URL },
      redirect: "manual",
    });

    if (response.status !== 200) {
      console.error("RUNTIME_BUILD_SHA_MISMATCH");
      console.error(`Runtime API returned HTTP ${response.status}`);
      console.error(`Git HEAD:         ${GIT_HEAD}`);
      console.error(`Configured SHA:   ${configuredSha ?? "NOT_SET"} [${configuredStatus}]`);
      process.exit(1);
    }

    const json = await response.json();
    if (!json?.ok || !json.data?.gitSha) {
      console.error("RUNTIME_BUILD_SHA_MISMATCH");
      console.error("Runtime API did not return valid Build Info");
      process.exit(1);
    }

    const runtimeSha = json.data.gitSha.trim();

    if (runtimeSha !== GIT_HEAD) {
      console.error("RUNTIME_BUILD_SHA_MISMATCH");
      console.error(`Git HEAD:         ${GIT_HEAD}`);
      console.error(`Configured SHA:   ${configuredSha ?? "NOT_SET"} [${configuredStatus}]`);
      console.error(`Runtime SHA:      ${runtimeSha}`);
      process.exit(1);
    }

    console.log(`Preflight PASS [runtime]`);
    console.log(`  Git HEAD:         ${GIT_HEAD}`);
    console.log(`  Configured SHA:   ${configuredSha ?? "NOT_SET"} [${configuredStatus}]`);
    console.log(`  Runtime SHA:      ${runtimeSha}`);
    process.exit(0);
  } catch (error) {
    console.error("RUNTIME_BUILD_SHA_MISMATCH");
    console.error(`Runtime API not reachable: ${error.message}`);
    console.error(`Git HEAD:         ${GIT_HEAD}`);
    console.error(`Configured SHA:   ${configuredSha ?? "NOT_SET"} [${configuredStatus}]`);
    process.exit(1);
  }
}
