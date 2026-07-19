/**
 * STAGING_OPERATIONS_V1 batch 2 (Agent E2) — restore-to-fresh CLI.
 *
 *   node scripts/backup/restore.mjs --dump <file> --db <target> --user postgres
 *   node scripts/backup/restore.mjs --dump <file> --url <conn>          # target db = conn's db
 *   node scripts/backup/restore.mjs --dump <file> --db <target> --force # allow a populated target
 *
 * Creates a FRESH target database (CREATE DATABASE) and pg_restores the custom-format archive into
 * it, then verifies object counts (tables / indexes / triggers / rows) post-restore. By default it
 * REFUSES to restore over an already-populated database (guarding against clobbering live data);
 * --force opts into a clean re-restore of an existing database.
 *
 * Safety: refuses any target whose name matches the production/recovery pattern; the target
 * identifier is validated before it is ever interpolated into CREATE DATABASE. The password is
 * passed to pg_restore only via PGPASSWORD and is never printed.
 */
import { existsSync } from "node:fs";
import { Pool } from "pg";
import {
  assertNotProtectedDb,
  assertSafeDbIdentifier,
  baseConnArgs,
  formatPgUrl,
  parseArgs,
  pgTool,
  pgToolsAvailable,
  resolveConnection,
  runProcess,
  verifyFileSha256,
  withDatabase,
} from "./pg-lib.mjs";

async function countTables(pool) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  return rows[0] ? rows[0].n : 0;
}

async function verifyRestore(targetParts) {
  const pool = new Pool({ connectionString: formatPgUrl(targetParts), max: 2 });
  try {
    const tables = await countTables(pool);
    const idx = await pool.query(
      `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const trg = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.triggers
        WHERE trigger_schema = 'public'`,
    );

    // Actual row totals across public base tables (bounded — we never restore a prod database).
    const names = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    let totalRows = 0;
    for (const r of names.rows) {
      const c = await pool.query(`SELECT count(*)::int AS n FROM "public"."${r.table_name}"`);
      totalRows += c.rows[0] ? c.rows[0].n : 0;
    }

    return {
      tables,
      indexes: idx.rows[0] ? idx.rows[0].n : 0,
      triggers: trg.rows[0] ? trg.rows[0].n : 0,
      totalRows,
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const dumpFile = typeof flags.dump === "string" ? flags.dump : null;
  if (!dumpFile) {
    console.error("restore: --dump <file> is required.");
    process.exit(2);
  }
  if (!existsSync(dumpFile)) {
    console.error(`restore: dump file not found: ${dumpFile}`);
    process.exit(2);
  }

  // A supplied checksum is verified before connection resolution and before ANY database access.
  // The generic restore CLI keeps this optional for backwards compatibility; the dedicated local
  // recovery drill always supplies it.
  if (typeof flags.checksum === "string") {
    const verified = await verifyFileSha256(dumpFile, flags.checksum);
    console.log(`CHECKSUM_VERIFIED sha256 ${verified}`);
  }

  const target = resolveConnection(flags);
  if (!target || !target.database) {
    console.error("restore: no target database resolved. Pass --db <name> (or --url).");
    process.exit(2);
  }

  // Hard guards before we touch the server.
  assertNotProtectedDb(target.database, "restore into");
  assertSafeDbIdentifier(target.database);

  if (!(await pgToolsAvailable())) {
    console.error("restore: pg_dump / pg_restore are not available on PATH or a known PostgreSQL bin dir.");
    process.exit(3);
  }

  const force = flags.force === true;
  const maintenance = withDatabase(target, "postgres");
  const admin = new Pool({ connectionString: formatPgUrl(maintenance), max: 2 });

  let created = false;
  try {
    const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
      target.database,
    ]);

    if (exists.rowCount && exists.rowCount > 0) {
      // Target already exists — refuse to clobber a populated database unless --force.
      const probe = new Pool({ connectionString: formatPgUrl(target), max: 1 });
      let populated = 0;
      try {
        populated = await countTables(probe);
      } finally {
        await probe.end();
      }
      if (populated > 0 && !force) {
        console.error(
          `restore: target "${target.database}" already exists and holds ${populated} table(s). ` +
            "Refusing to restore over it. Re-run with --force to overwrite, or choose a fresh --db.",
        );
        process.exit(4);
      }
      console.log(
        `restore: target "${target.database}" exists (${populated} table(s)); ${force ? "--force: restoring with --clean" : "empty: restoring"}.`,
      );
    } else {
      console.log(`restore: creating fresh target database "${target.database}".`);
      await admin.query(`CREATE DATABASE "${target.database}"`);
      created = true;
    }
  } finally {
    await admin.end();
  }

  const restoreArgs = [
    ...baseConnArgs(target),
    "-d",
    target.database,
    "--no-owner",
    "--no-acl",
  ];
  if (force && !created) restoreArgs.push("--clean", "--if-exists");
  restoreArgs.push(dumpFile);

  console.log(`restore: pg_restore ${dumpFile} -> "${target.database}"`);
  const res = await runProcess(pgTool("pg_restore"), restoreArgs, { password: target.password });
  // pg_restore prints benign warnings to stderr on a fresh restore; surface only if present.
  if (res.stderr.trim()) {
    console.log(`restore: pg_restore notices:\n${res.stderr.trim()}`);
  }

  const counts = await verifyRestore(target);
  console.log(
    `RESTORED ${target.database} tables=${counts.tables} indexes=${counts.indexes} ` +
      `triggers=${counts.triggers} rows=${counts.totalRows}`,
  );
  if (counts.tables === 0) {
    console.error("restore: post-restore verification found ZERO tables — the restore did not populate the target.");
    process.exit(5);
  }
  console.log("restore: done.");
}

main().catch((err) => {
  console.error(`restore: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
