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
 *
 * CANONICAL PROVIDER IDENTITY (src/runtime/provider/identity.ts): any run of this canary calls a
 * DEEPSEEK model through the ALIYUN_MAAS gateway over the OPENAI_COMPATIBLE protocol. The canary
 * test declares exactly that identity on the adapter, and the ledger row it writes carries it as
 * gateway_vendor / model_vendor / protocol. The identity is declared configuration — never derived
 * from PROVIDER_BASE_URL, and no endpoint host / workspace id is ever persisted.
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

// 3. Canary database isolation (ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1): the canary reads
//    ONLY GEO_CANARY_DATABASE_URL — it never falls back to (or overrides) GEO_TEST_DATABASE_URL
//    or GEO_DATABASE_URL, and its target must differ from both (host+port+dbname).
function dbTarget(raw) {
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return null;
  }
}
const canaryDbUrl = process.env.GEO_CANARY_DATABASE_URL ?? "";
if (!canaryDbUrl) die(2, "GEO_CANARY_DATABASE_URL is not set (the canary NEVER falls back to GEO_TEST_DATABASE_URL / GEO_DATABASE_URL). Aborting.");
const canaryTarget = dbTarget(canaryDbUrl);
if (!canaryTarget) die(2, "GEO_CANARY_DATABASE_URL is not a parseable postgres URL. Aborting.");
if (!/canary/i.test(canaryTarget.split("/").pop() ?? "")) die(2, "GEO_CANARY_DATABASE_URL must point at a clearly-labelled canary database (name contains 'canary'). Aborting.");
for (const [otherVar, label] of [["GEO_DATABASE_URL", "runtime"], ["GEO_TEST_DATABASE_URL", "test"]]) {
  const other = dbTarget(process.env[otherVar] ?? "");
  if (other && other === canaryTarget) {
    die(2, `GEO_CANARY_DATABASE_URL points at the ${label} database — the canary requires its own isolated database. Aborting.`);
  }
}

// 4. Model guard (non-secret).
const model = process.env.PROVIDER_MODEL ?? "";
if (model !== "deepseek-v4-flash") die(2, `PROVIDER_MODEL must be deepseek-v4-flash (got "${model}"). Aborting.`);

const summaryPath = join(process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp", "geo-provider-micro-canary-summary.json");
try { rmSync(summaryPath, { force: true }); } catch { /* ignore */ }

console.log("micro-canary: environment validated (key present, flag ON for this process, isolated canary db, model deepseek-v4-flash).");
console.log("micro-canary: canonical identity = gateway ALIYUN_MAAS / model vendor DEEPSEEK / protocol OPENAI_COMPATIBLE (declared config, never derived from the URL).");
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
