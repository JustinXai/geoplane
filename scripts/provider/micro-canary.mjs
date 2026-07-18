/**
 * SANITIZED_PROVIDER_MICRO_CANARY_V1 runner.
 *
 * Intended entry point:
 *   node --env-file=<the .env.local holding DEEPSEEK_API_KEY> \
 *        -e "process.env.PROVIDER_RUNTIME_ENABLED='true'; import('./scripts/provider/micro-canary.mjs')"
 *
 * The runner NEVER prints the key. It validates the environment, then runs the single canary test
 * (tests/pilot/provider-micro-canary.canary.test.ts) via vitest — the only entry point that
 * resolves the TypeScript adapter/ledger — with RUN_PROVIDER_CANARY=true, and prints the sanitized
 * summary the test writes (model / result / tokens / latency / ledger row — no key, prompt, or response).
 * It makes AT MOST ONE real network request (the test's fetch guard enforces this).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function die(code, msg) {
  console.error(`micro-canary: ${msg}`);
  process.exit(code);
}

// 1. Stale generic key guard — never use or print it.
if (process.env.PROVIDER_API_KEY) {
  console.log("STALE_GENERIC_PROVIDER_KEY_PRESENT");
  die(2, "a stale PROVIDER_API_KEY is present; remove it and use DEEPSEEK_API_KEY only. Aborting.");
}
if (!process.env.DEEPSEEK_API_KEY) die(2, "DEEPSEEK_API_KEY is not set (load it via --env-file). Aborting.");

// 2. Runtime flag must be ON only for this process (set by the -e wrapper), never persisted.
if (process.env.PROVIDER_RUNTIME_ENABLED !== "true") {
  die(2, "PROVIDER_RUNTIME_ENABLED must be 'true' for this single canary process (set it in the -e wrapper, not .env.local).");
}

// 3. Database must be a throwaway TEST/PILOT/CANARY db, never the production runtime db.
const testDbUrl = process.env.GEO_TEST_DATABASE_URL ?? "";
if (!testDbUrl) die(2, "GEO_TEST_DATABASE_URL is not set. Aborting.");
if (/\/geoplane_runtime(\?|$)/.test(testDbUrl)) die(2, "refusing to run against the production runtime database. Aborting.");
if (!/test|pilot|canary/i.test(testDbUrl)) die(2, "GEO_TEST_DATABASE_URL must clearly be a test/pilot/canary database. Aborting.");

// 4. Model guard (non-secret).
const model = process.env.PROVIDER_MODEL ?? "";
if (model !== "deepseek-v4-flash") die(2, `PROVIDER_MODEL must be deepseek-v4-flash (got "${model}"). Aborting.`);

const summaryPath = join(process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp", "geo-provider-micro-canary-summary.json");
try { rmSync(summaryPath, { force: true }); } catch { /* ignore */ }

console.log("micro-canary: environment validated (key present, flag ON for this process, test db, model deepseek-v4-flash).");
console.log(`micro-canary: base url host = ${(() => { try { return new URL(process.env.PROVIDER_BASE_URL ?? "").host; } catch { return "(unset)"; } })()}`);
console.log("micro-canary: running the single canary via vitest (RUN_PROVIDER_CANARY=true) …");

const vitestEntry = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const testFile = join(repoRoot, "tests", "pilot", "provider-micro-canary.canary.test.ts");
const res = spawnSync(
  process.execPath,
  [vitestEntry, "run", testFile, "--no-file-parallelism"],
  { cwd: repoRoot, stdio: "inherit", env: { ...process.env, RUN_PROVIDER_CANARY: "true" } },
);

if (existsSync(summaryPath)) {
  console.log("\n===== SANITIZED MICRO-CANARY SUMMARY (no key / prompt / response) =====");
  console.log(readFileSync(summaryPath, "utf8"));
  console.log("======================================================================");
} else {
  console.error("micro-canary: no summary written (the canary did not complete a call).");
}

process.exit(res.status ?? 1);
