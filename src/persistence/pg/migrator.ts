/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 - a real, ordered,
 *   idempotent migration runner with a schema_migrations ledger. Each *.sql file carries its
 *   OWN BEGIN/COMMIT (see 0001), so this runner executes the file as a single multi-statement
 *   query and does NOT open an outer transaction. A checksum mismatch on an already-applied
 *   file is a hard error (migrations are immutable once applied).
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Queryable } from "../database-port.js";

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

export interface MigrationRunResult {
  readonly applied: string[];
  readonly skipped: string[];
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function applyMigrations(
  db: Queryable,
  migrationsDir: string,
): Promise<MigrationRunResult> {
  await db.query(LEDGER_DDL);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const filename of files) {
    const sql = readFileSync(join(migrationsDir, filename), "utf8");
    const checksum = sha256(sql);

    const existing = await db.query<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE filename = $1",
      [filename],
    );

    const priorRow = existing.rows[0];
    if (priorRow) {
      if (priorRow.checksum !== checksum) {
        throw new Error(
          `Migration ${filename} was modified after being applied ` +
            `(recorded checksum != current). Migrations are immutable; add a new file instead.`,
        );
      }
      skipped.push(filename);
      continue;
    }

    // The .sql file provides its own transaction boundary.
    await db.query(sql);
    await db.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
      [filename, checksum],
    );
    applied.push(filename);
  }

  return { applied, skipped };
}
