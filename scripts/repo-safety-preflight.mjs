#!/usr/bin/env node
/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * repo:safety:preflight — local-only repository and recovery-source safety checks.
 *
 * LOCAL_ONLY_MODE is the permanent posture for this stage. This script never reads or prints a
 * remote URL, never inspects remote-tracking refs, never recommends a push, and uses only local
 * filesystem/config/object-database operations. No command here can contact a network service.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const RECOVERY_SOURCE = process.env.GEO_RECOVERY_SOURCE ?? "E:\\GEO_RECOVERY_SAFE";
const PROTECTED_PATTERNS = [/^geo/i, /^geoplane/i, /^geo-control-plane/i];

function fail(msg) {
  console.error(`PREFLIGHT FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`PREFLIGHT OK: ${msg}`);
}

function localSetting(name) {
  const fromProcess = process.env[name];
  if (typeof fromProcess === "string" && fromProcess.trim() !== "") return fromProcess.trim();
  if (!existsSync(".env.local")) return null;
  for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1 || line.slice(0, equals).trim() !== name) continue;
    return line.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return null;
}

// Both stage gates are fail-closed. Values may come from the process or the gitignored local file.
if (localSetting("LOCAL_ONLY_MODE") !== "TRUE") fail("LOCAL_ONLY_MODE must be exactly TRUE");
if (localSetting("REMOTE_WRITE") !== "FORBIDDEN") fail("REMOTE_WRITE must be exactly FORBIDDEN");
ok("LOCAL_ONLY_MODE active; remote state is intentionally not inspected");
ok("REMOTE_WRITE is FORBIDDEN");

// .git accessible using only the local filesystem/object database.
if (!existsSync(".git") && !existsSync(resolve(".git"))) {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
  } catch {
    fail(".git not accessible");
  }
}
ok(".git accessible");

let head;
let branch;
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  ok(`local HEAD resolves to ${head}`);
  ok(`local branch resolves to ${branch}`);
} catch {
  fail("local HEAD or branch does not resolve");
}

// Local work branches must not carry an upstream in this stage.
let configuredUpstream = "";
try {
  configuredUpstream = execFileSync(
    "git",
    ["config", "--get", `branch.${branch}.remote`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  // git config --get exits 1 when the key is absent; absence is the required local-only state.
}
if (configuredUpstream !== "") fail("local branch must not have an upstream in LOCAL_ONLY_MODE");
ok("local branch has no upstream");

// Working directory must remain outside the read-only recovery evidence tree.
const cwd = realpathSync(process.cwd());
if (cwd.toLowerCase().startsWith(RECOVERY_SOURCE.toLowerCase())) {
  fail("current working directory is inside the read-only recovery source");
}
ok("working directory is not the recovery source");

// Delete-target and evidence checks remain caller-enforced contracts.
ok(`protected path patterns loaded: ${PROTECTED_PATTERNS.map((pattern) => pattern.source).join(", ")}`);
ok("recovery-source mutation check delegated to caller's checksum spot-check");

console.log("repo:safety:preflight PASS (local-only)");
