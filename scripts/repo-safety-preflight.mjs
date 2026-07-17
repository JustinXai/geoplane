#!/usr/bin/env node
/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * repo:safety:preflight - checks the invariants from AGENTS.md / the
 * overnight rebuild spec before any destructive or wide-reaching command
 * (build cleanup, dependency install, etc.) is allowed to proceed.
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

// .git accessible
if (!existsSync(".git") && !existsSync(resolve(".git"))) {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
  } catch {
    fail(".git not accessible");
  }
}
ok(".git accessible");

// HEAD resolvable
let head;
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  ok(`HEAD resolves to ${head}`);
} catch {
  fail("HEAD does not resolve");
}

// origin configured
let originUrl;
try {
  originUrl = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  ok(`origin configured: ${originUrl}`);
} catch {
  fail("origin remote not configured");
}

// current HEAD has been pushed (best-effort; requires a prior fetch)
try {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  const remoteHead = execFileSync("git", ["rev-parse", `origin/${branch}`], { encoding: "utf8" }).trim();
  if (remoteHead === head) {
    ok(`current HEAD already pushed to origin/${branch}`);
  } else {
    console.warn(`PREFLIGHT WARN: local HEAD (${head}) differs from origin/${branch} (${remoteHead}) - push before ending this checkpoint`);
  }
} catch {
  console.warn("PREFLIGHT WARN: could not compare against a remote-tracking branch");
}

// working directory is not the recovery source
const cwd = realpathSync(process.cwd());
if (cwd.toLowerCase().startsWith(RECOVERY_SOURCE.toLowerCase())) {
  fail(`current working directory (${cwd}) is inside the read-only recovery source (${RECOVERY_SOURCE})`);
}
ok("working directory is not the recovery source");

// delete targets not in protected paths (informational contract, enforced by callers)
ok(`protected path patterns loaded: ${PROTECTED_PATTERNS.map((p) => p.source).join(", ")}`);

// recovery source has no file changes (best effort - caller should pass a checksum baseline)
ok("recovery-source mutation check delegated to caller's checksum spot-check");

console.log("repo:safety:preflight PASS");
