/** Shared LOCAL_ONLY_MODE helpers for the operator backup and restore-verification commands. */
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { formatPgUrl, resolveVar } from "../backup/pg-lib.mjs";

export const LOCAL_RUNTIME_DB = "geoplane_local_runtime";
export const LOCAL_RESTORE_VERIFY_DB = "geoplane_local_restore_verify";
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const BUSINESS_TABLES = [
  "user",
  "organization",
  "membership",
  "project",
  "knowledge_package",
  "knowledge_content",
  "opportunity",
  "article_brief",
  "provider_article_content",
  "article_draft",
  "distribution_plan",
  "publication_receipt",
  "delivery",
  "audit_event",
  "provider_execution",
  "session",
];

export function assertLocalOnlyMode() {
  if (resolveVar("LOCAL_ONLY_MODE") !== "TRUE") {
    throw new Error("LOCAL_ONLY_MODE must be exactly TRUE");
  }
  if (resolveVar("REMOTE_WRITE") !== "FORBIDDEN") {
    throw new Error("REMOTE_WRITE must be exactly FORBIDDEN");
  }
}

export function resolveLocalVar(name) {
  return resolveVar(name);
}

export function assertLoopback(parts) {
  if (!LOOPBACK_HOSTS.has(String(parts.host).toLowerCase())) {
    throw new Error(`refusing non-loopback PostgreSQL host "${parts.host}" in LOCAL_ONLY_MODE`);
  }
}

export function assertExactDatabase(parts, expected, action) {
  if (parts.database !== expected) {
    throw new Error(
      `refusing to ${action} database "${parts.database}": expected exact local database "${expected}"`,
    );
  }
}

export function outsideRepoDirectory(requested) {
  const requestedPath = resolve(requested);
  mkdirSync(requestedPath, { recursive: true });
  const output = realpathSync(requestedPath);
  const root = realpathSync(repoRoot);
  const fromRepo = relative(root, output);
  if (fromRepo === "" || (!fromRepo.startsWith("..") && !isAbsolute(fromRepo))) {
    throw new Error("backup evidence directory must be outside the repository");
  }
  return output;
}

export function providerCredentialFreeEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(?:OPENAI|PROVIDER|ANTHROPIC|GEMINI).*?(?:API_KEY|TOKEN|SECRET)$/i.test(name)) {
      delete env[name];
    }
  }
  env.PROVIDER_RUNTIME_ENABLED = "false";
  return env;
}

export function evidenceLine(output, prefix) {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`command did not emit required ${prefix.trim()} evidence`);
  return line.slice(prefix.length).trim();
}

function canonicalSummaryHash(summary) {
  return createHash("sha256").update(JSON.stringify(summary), "utf8").digest("hex");
}

/**
 * Read business state without returning row content. PostgreSQL hashes canonical row JSON inside
 * the database; output contains only row counts and digests. A missing business table is a failure.
 */
export async function readBusinessSummary(parts) {
  const pool = new Pool({ connectionString: formatPgUrl(parts), max: 2 });
  try {
    const migrations = await pool.query(`SELECT count(*)::int AS n FROM schema_migrations`);
    const tables = {};
    for (const table of BUSINESS_TABLES) {
      const result = await pool.query(
        `SELECT count(*)::int AS row_count,
                md5(COALESCE(string_agg(row_json, E'\\n' ORDER BY row_json), '')) AS fingerprint
           FROM (SELECT row_to_json(t)::text AS row_json FROM "${table}" AS t) AS rows_to_hash`,
      );
      tables[table] = {
        rows: result.rows[0]?.row_count ?? 0,
        fingerprint: result.rows[0]?.fingerprint ?? "",
      };
    }
    const summary = { migrations: migrations.rows[0]?.n ?? 0, tables };
    return { ...summary, summarySha256: canonicalSummaryHash(summary) };
  } finally {
    await pool.end();
  }
}

export function summariesEqual(left, right) {
  return left.summarySha256 === right.summarySha256;
}

export function withDatabase(parts, database) {
  return { ...parts, database };
}

export function defaultLocalEvidenceDir(tmpBase) {
  return join(tmpBase, "geoplane-local-backups");
}
