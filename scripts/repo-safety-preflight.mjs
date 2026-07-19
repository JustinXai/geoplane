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
import { existsSync, realpathSync } from "node:fs";
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

// LOCAL_ONLY_MODE is fail-closed. No other posture is accepted by this stage's safety gate.
const localOnly = String(process.env.LOCAL_ONLY_MODE ?? "true").trim().toLowerCase();
if (!["true", "1"].includes(localOnly)) fail("LOCAL_ONLY_MODE must remain true");
ok("LOCAL_ONLY_MODE active; remote state is intentionally not inspected");

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
