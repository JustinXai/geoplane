/**
 * STAGING_OPERATIONS_V1 batch 2 (Agent E2) — database backup CLI.
 *
 *   node scripts/backup/backup.mjs                       # dump GEO_DATABASE_URL (custom format)
 *   node scripts/backup/backup.mjs --test                # dump GEO_TEST_DATABASE_URL
 *   node scripts/backup/backup.mjs --url <conn>          # dump an explicit connection
 *   node scripts/backup/backup.mjs --db <name> --user postgres   # dump a sibling db as another role
 *   node scripts/backup/backup.mjs --out <dir>           # output directory (default: os tmp)
 *
 * Produces a PostgreSQL custom-format (-Fc) archive at
 *   <out>/<database>_<utc-timestamp>.dump
 * and prints the artifact path plus its sha256 checksum. The custom format is compressed and is
 * what pg_restore consumes for a selective / parallel restore into a FRESH database.
 *
 * Safety: refuses to dump any database whose name matches the production/recovery pattern (see
 * pg-lib PRODUCTION_DB_PATTERN). The connection password is passed only via PGPASSWORD and is
 * never printed. The artifact path is *.dump (gitignored) and defaults to the OS temp dir, so a
 * backup is never accidentally committed to the tree.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNotProtectedDb,
  baseConnArgs,
  fileTimestamp,
  parseArgs,
  pgTool,
  pgToolsAvailable,
  resolveConnection,
  runProcess,
  sha256File,
} from "./pg-lib.mjs";

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const conn = resolveConnection(flags);
  if (!conn || !conn.database) {
    console.error(
      "backup: no database resolved. Set GEO_DATABASE_URL (or pass --url/--db), " +
        "or use --test for GEO_TEST_DATABASE_URL.",
    );
    process.exit(2);
  }

  // Hard guard: never back up a production / recovery-source database.
  assertNotProtectedDb(conn.database, "back up");

  if (!(await pgToolsAvailable())) {
    console.error("backup: pg_dump / pg_restore are not available on PATH or a known PostgreSQL bin dir.");
    process.exit(3);
  }

  const outDir =
    typeof flags.out === "string" ? flags.out : join(tmpdir(), "geoplane-backups");
  mkdirSync(outDir, { recursive: true });

  const artifact = join(outDir, `${conn.database}_${fileTimestamp()}.dump`);

  const args = [
    ...baseConnArgs(conn),
    "-Fc", // custom format
    "--no-owner",
    "--no-acl",
    "-f",
    artifact,
    conn.database,
  ];

  console.log(`backup: dumping "${conn.database}" (${conn.host}:${conn.port}) -> ${artifact}`);
  await runProcess(pgTool("pg_dump"), args, { password: conn.password });

  const checksum = await sha256File(artifact);
  console.log(`ARTIFACT ${artifact}`);
  console.log(`CHECKSUM sha256 ${checksum}`);
  console.log("backup: done.");
}

main().catch((err) => {
  console.error(`backup: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
