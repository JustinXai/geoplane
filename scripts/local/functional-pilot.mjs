#!/usr/bin/env node
/**
 * LOCAL_FUNCTIONAL_PILOT_V1
 *
 * Runs the existing fully-sanitized three-role pilot through the real Next.js route handlers,
 * signed sessions, authorization and PostgreSQL. This entry point adds local-staging containment:
 * it can target only the dedicated loopback `geoplane_local_test` database, forces the provider
 * runtime OFF, strips live-provider configuration from the child process, and emits only aggregate
 * evidence after the HTTP chain has completed.
 *
 * The pilot test intentionally resets the TEST database. It never reads GEO_DATABASE_URL and this
 * runner refuses any database name other than `geoplane_local_test` before Vitest is started.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REQUIRED_DATABASE = "geoplane_local_test";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PROVIDER_SECRET_NAMES = [
  "DEEPSEEK_API_KEY",
  "PROVIDER_API_KEY",
  "PROVIDER_BASE_URL",
  "PROVIDER_MODEL",
];

function readEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const name = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

export function resolveLocalPilotEnvironment(
  processEnvironment = process.env,
  envFilePath = join(repoRoot, ".env.local"),
) {
  const fileEnvironment = readEnvFile(envFilePath);
  return { ...fileEnvironment, ...processEnvironment };
}

function parseDatabaseTarget(raw, variableName) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${variableName} must use the postgresql protocol`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    database,
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
    target: `${url.hostname.toLowerCase()}:${url.port || "5432"}/${database}`,
  };
}

function requireConfiguredKey(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the local functional pilot`);
  if (value.length < 16 || /change[_ -]?me|insecure|example|placeholder/i.test(value)) {
    throw new Error(`${name} is present but does not meet the local staging key policy`);
  }
}

export function validateLocalPilotEnvironment(environment) {
  const rawTestUrl = environment.GEO_TEST_DATABASE_URL?.trim();
  if (!rawTestUrl) {
    throw new Error("GEO_TEST_DATABASE_URL is required; no database fallback is allowed");
  }
  const test = parseDatabaseTarget(rawTestUrl, "GEO_TEST_DATABASE_URL");
  if (!LOOPBACK_HOSTS.has(test.host)) {
    throw new Error("GEO_TEST_DATABASE_URL must use a loopback host");
  }
  if (test.database !== REQUIRED_DATABASE) {
    throw new Error(`GEO_TEST_DATABASE_URL must target exactly ${REQUIRED_DATABASE}`);
  }

  for (const [name, label] of [
    ["GEO_DATABASE_URL", "runtime"],
    ["GEO_CANARY_DATABASE_URL", "canary"],
  ]) {
    const raw = environment[name]?.trim();
    if (!raw) continue;
    const other = parseDatabaseTarget(raw, name);
    if (other.target === test.target) {
      throw new Error(`test database must not equal the ${label} database`);
    }
  }

  if (environment.PROVIDER_RUNTIME_ENABLED?.trim().toLowerCase() !== "false") {
    throw new Error("PROVIDER_RUNTIME_ENABLED must be explicitly false");
  }
  if (environment.RUN_PROVIDER_CANARY?.trim().toLowerCase() === "true") {
    throw new Error("RUN_PROVIDER_CANARY must not be enabled in LOCAL_ONLY_MODE");
  }
  requireConfiguredKey(environment, "SESSION_SIGNING_KEY_CURRENT");
  requireConfiguredKey(environment, "REVIEW_REFERENCE_KEY_CURRENT");

  return { database: test.database, host: test.host, port: test.port };
}

export function makeContainedChildEnvironment(environment) {
  const child = { ...environment };
  for (const name of PROVIDER_SECRET_NAMES) delete child[name];
  child.PROVIDER_RUNTIME_ENABLED = "false";
  child.RUN_PROVIDER_CANARY = "false";
  child.NODE_ENV = "test";
  return child;
}

async function collectSanitizedEvidence(connectionString) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        (SELECT count(*)::int FROM membership WHERE role = 'PLATFORM_SUPER_ADMIN' AND status = 'ACTIVE') AS platform_admins,
        (SELECT count(*)::int FROM membership WHERE role = 'AGENCY_OWNER' AND status = 'ACTIVE') AS agency_owners,
        (SELECT count(*)::int FROM membership WHERE role = 'CLIENT_OWNER' AND status = 'ACTIVE') AS client_owners,
        (SELECT count(*)::int FROM agency_client_assignment WHERE status = 'ACTIVE') AS active_assignments,
        (SELECT count(*)::int FROM project) AS projects,
        (SELECT count(*)::int FROM knowledge_package WHERE status = 'CONFIRMED') AS confirmed_packages,
        (SELECT count(*)::int FROM human_review_decision WHERE decision = 'APPROVED' AND reviewer_user_id IS NOT NULL) AS human_reviews,
        (SELECT count(*)::int FROM article_approval WHERE approver_user_id IS NOT NULL) AS article_approvals,
        (SELECT count(*)::int FROM delivery WHERE client_readable = true) AS deliveries,
        (SELECT count(*)::int FROM publication_receipt
          WHERE lower(trim(published_by_actor_id)) IN ('system', 'auto', 'automated', 'automatic')) AS automatic_publications,
        (SELECT count(*)::int FROM channel_neutral_content_package
          WHERE coalesce(array_length(target_channel_ids, 1), 0) = 0) AS zero_default_channel_packages,
        (SELECT count(*)::int FROM provider_execution) AS provider_executions,
        (SELECT count(*)::int FROM provider_article_content
          WHERE provider_response_envelope_id LIKE 'offline_pilot_%') AS offline_provider_contents,
        (SELECT count(*)::int FROM audit_event) AS audit_events,
        (SELECT count(*)::int FROM audit_event
          WHERE actor_user_id IS NULL OR event_hash IS NULL OR length(event_hash) = 0) AS invalid_audit_events,
        (SELECT count(*)::int FROM "user"
          WHERE email !~* '@([a-z0-9-]+\\.)*(example|test)$' AND email !~* '\\.test$') AS non_sanitized_users,
        (SELECT count(*)::int FROM organization
          WHERE display_name !~* '(sample|pilot fixture)') AS non_sanitized_organizations
    `);
    const row = result.rows[0];
    if (!row) throw new Error("local functional pilot evidence query returned no row");

    const failures = [];
    for (const [field, minimum] of [
      ["platform_admins", 1],
      ["agency_owners", 1],
      ["client_owners", 1],
      ["active_assignments", 1],
      ["projects", 1],
      ["confirmed_packages", 1],
      ["human_reviews", 1],
      ["article_approvals", 1],
      ["deliveries", 1],
      ["zero_default_channel_packages", 1],
      ["offline_provider_contents", 1],
      ["audit_events", 1],
    ]) {
      if (Number(row[field]) < minimum) failures.push(`${field} < ${minimum}`);
    }
    for (const field of [
      "automatic_publications",
      "provider_executions",
      "invalid_audit_events",
      "non_sanitized_users",
      "non_sanitized_organizations",
    ]) {
      if (Number(row[field]) !== 0) failures.push(`${field} != 0`);
    }
    if (row.database_name !== REQUIRED_DATABASE) failures.push("database identity changed");
    if (failures.length > 0) {
      throw new Error(`post-run invariant verification failed: ${failures.join(", ")}`);
    }

    return {
      database: row.database_name,
      roles: {
        platformAdmin: Number(row.platform_admins),
        agencyOwner: Number(row.agency_owners),
        clientOwner: Number(row.client_owners),
      },
      activeAssignments: Number(row.active_assignments),
      projects: Number(row.projects),
      confirmedKnowledgePackages: Number(row.confirmed_packages),
      humanReviews: Number(row.human_reviews),
      articleApprovals: Number(row.article_approvals),
      deliveries: Number(row.deliveries),
      automaticPublications: Number(row.automatic_publications),
      zeroDefaultChannelPackages: Number(row.zero_default_channel_packages),
      providerRealCallsThisStage: Number(row.provider_executions),
      offlineProviderContents: Number(row.offline_provider_contents),
      auditEvents: Number(row.audit_events),
      invalidAuditEvents: Number(row.invalid_audit_events),
      realCustomerDataRows: Number(row.non_sanitized_users) + Number(row.non_sanitized_organizations),
    };
  } finally {
    await pool.end();
  }
}

export async function runLocalFunctionalPilot(args = process.argv.slice(2)) {
  const environment = resolveLocalPilotEnvironment();
  const target = validateLocalPilotEnvironment(environment);
  console.log(
    `local-functional-pilot: containment PASS (database=${target.database}, host=loopback, provider=OFF)`,
  );
  if (args.includes("--validate-only")) return;

  const vitestEntry = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  if (!existsSync(vitestEntry)) {
    throw new Error("dependencies are not installed (Vitest entry point is missing)");
  }
  const testFile = join(repoRoot, "tests", "pilot", "pilot-acceptance.e2e.pg.test.ts");
  const result = spawnSync(
    process.execPath,
    [vitestEntry, "run", testFile, "--no-file-parallelism"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: makeContainedChildEnvironment(environment),
    },
  );
  if (result.status !== 0) {
    throw new Error(`three-role HTTP pilot failed with exit code ${result.status ?? "unknown"}`);
  }

  const evidence = await collectSanitizedEvidence(environment.GEO_TEST_DATABASE_URL);
  console.log("local-functional-pilot: SANITIZED EVIDENCE");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("local-functional-pilot: PASS");
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (isMain) {
  runLocalFunctionalPilot().catch((error) => {
    console.error(`local-functional-pilot: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
