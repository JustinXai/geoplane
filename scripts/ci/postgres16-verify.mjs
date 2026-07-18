/**
 * CI_REPRODUCIBLE_DATABASE_GATE_V1 (Agent C) — canonical PostgreSQL major-version gate.
 *
 *   node scripts/ci/postgres16-verify.mjs                     # strict: major MUST be 16 (CI)
 *   node scripts/ci/postgres16-verify.mjs --allow-major 18    # local dev on PostgreSQL 18
 *   node scripts/ci/postgres16-verify.mjs --url <conn>        # explicit target
 *
 * Connects to GEO_DATABASE_URL (env, then .env.local — or --url), runs
 * SELECT version(), prints the sanitized server version string (the version
 * string only — never the URL, never a credential), and asserts the server
 * MAJOR version is 16. --allow-major <n> additionally accepts major <n> so the
 * identical chain can be exercised on the local PG18 dev instance; CI omits the
 * flag and stays strictly on the canonical PostgreSQL 16.
 *
 * Exit codes: 0 = version acceptable · 1 = mismatch/unreachable · 2 = misuse.
 * Failures carry a classified CI_PG16_* message. No exception is swallowed.
 */
import { Pool } from "pg";
import { parseArgs, resolveVar } from "../backup/pg-lib.mjs";

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const allowedMajors = new Set([16]);
  if (flags["allow-major"] !== undefined) {
    const n = Number.parseInt(String(flags["allow-major"]), 10);
    if (!Number.isInteger(n) || n < 9 || n > 99) {
      console.error("postgres16-verify: CI_PG16_USAGE — --allow-major requires an integer major version (e.g. 18).");
      process.exit(2);
    }
    allowedMajors.add(n);
  }

  const url = typeof flags.url === "string" ? flags.url : resolveVar("GEO_DATABASE_URL");
  if (!url) {
    console.error(
      "postgres16-verify: CI_PG16_TARGET_UNRESOLVED — GEO_DATABASE_URL is not set (checked process.env and .env.local) and no --url was given.",
    );
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  let versionString;
  let serverVersion;
  try {
    const res = await pool.query("SELECT version() AS version_string, current_setting('server_version') AS server_version");
    versionString = String(res.rows[0].version_string);
    serverVersion = String(res.rows[0].server_version);
  } catch (err) {
    console.error(
      `postgres16-verify: CI_PG16_UNREACHABLE — could not query the target server: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  } finally {
    await pool.end().catch(() => undefined);
  }

  // Sanitized: the server's own version strings carry no credential or URL.
  console.log(`postgres16-verify: server version string = ${versionString}`);

  const majorMatch = /^(\d+)/.exec(serverVersion.trim());
  if (!majorMatch) {
    console.error(
      `postgres16-verify: CI_PG16_VERSION_UNPARSEABLE — cannot extract a major version from server_version "${serverVersion}".`,
    );
    process.exit(1);
  }
  const major = Number.parseInt(majorMatch[1], 10);

  if (!allowedMajors.has(major)) {
    console.error(
      `postgres16-verify: CI_PG16_MAJOR_MISMATCH — server major version is ${major}, ` +
        `allowed: ${[...allowedMajors].sort((a, b) => a - b).join(", ")} ` +
        "(CI requires the canonical PostgreSQL 16; use --allow-major only for local dev runs).",
    );
    process.exit(1);
  }

  const strict = allowedMajors.size === 1;
  console.log(
    `postgres16-verify: PASS — major version ${major} accepted${strict ? " (strict canonical 16)" : ` (allowed: ${[...allowedMajors].sort((a, b) => a - b).join(", ")})`}.`,
  );
}

main().catch((err) => {
  console.error(`postgres16-verify: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
