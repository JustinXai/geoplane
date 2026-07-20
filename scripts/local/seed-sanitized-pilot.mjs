#!/usr/bin/env node
/** LOCAL_SANITIZED_RUNTIME_SEED_V1 — idempotent bootstrap for geoplane_local_runtime only. */
import { scryptSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function uuid() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REQUIRED_DATABASE = "geoplane_local_runtime";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PASSWORD_VARIABLES = [
  "LOCAL_PLATFORM_ADMIN_PASSWORD",
  "LOCAL_AGENCY_OWNER_PASSWORD",
  "LOCAL_CLIENT_OWNER_PASSWORD",
];

export const SANITIZED_RUNTIME_FIXTURES = {
  platform: {
    email: "platform-admin@local-pilot.example.test",
    orgName: "Sample Local Platform (Pilot Fixture)",
    orgKey: "local-pilot-platform-v1",
    role: "PLATFORM_SUPER_ADMIN",
  },
  agency: {
    email: "agency-owner@local-pilot.example.test",
    orgName: "Sample Local Agency (Pilot Fixture)",
    orgKey: "local-pilot-agency-v1",
    role: "AGENCY_OWNER",
  },
  client: {
    email: "client-owner@local-pilot.example.test",
    orgName: "Sample Local Client (Pilot Fixture)",
    orgKey: "local-pilot-client-v1",
    role: "CLIENT_OWNER",
  },
  projectName: "Sample Local Closed Pilot Project",
};

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const name = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

export function resolveSeedEnvironment(
  processEnvironment = process.env,
  envFilePath = join(repoRoot, ".env.local"),
) {
  return { ...readEnvFile(envFilePath), ...processEnvironment };
}

function passwordPolicy(value, name) {
  if (!value) throw new Error(`${name} is required`);
  if (value.length < 12 || Buffer.byteLength(value, "utf8") > 1024) {
    throw new Error(`${name} must be at least 12 characters and at most 1024 bytes`);
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    throw new Error(`${name} must contain lowercase, uppercase, and numeric characters`);
  }
  if (/password|change[_ -]?me|example|placeholder/i.test(value)) {
    throw new Error(`${name} matches a forbidden placeholder pattern`);
  }
}

function databaseTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("GEO_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("GEO_DATABASE_URL must use the postgresql protocol");
  }
  return { host: url.hostname.toLowerCase(), database: decodeURIComponent(url.pathname.slice(1)) };
}

export function validateSeedEnvironment(environment) {
  const runtimeUrl = environment.GEO_DATABASE_URL?.trim();
  if (!runtimeUrl) throw new Error("GEO_DATABASE_URL is required; no fallback is allowed");
  const target = databaseTarget(runtimeUrl);
  if (!LOOPBACK_HOSTS.has(target.host)) throw new Error("GEO_DATABASE_URL must use a loopback host");
  if (target.database !== REQUIRED_DATABASE) {
    throw new Error(`GEO_DATABASE_URL must target exactly ${REQUIRED_DATABASE}`);
  }
  if (environment.PROVIDER_RUNTIME_ENABLED?.trim().toLowerCase() !== "false") {
    throw new Error("PROVIDER_RUNTIME_ENABLED must be explicitly false");
  }
  for (const keyName of ["SESSION_SIGNING_KEY_CURRENT", "REVIEW_REFERENCE_KEY_CURRENT"]) {
    if (!environment[keyName]?.trim()) throw new Error(`${keyName} is required`);
  }
  for (const name of PASSWORD_VARIABLES) passwordPolicy(environment[name], name);
  const passwords = new Set(PASSWORD_VARIABLES.map((name) => environment[name]));
  if (passwords.size !== PASSWORD_VARIABLES.length) {
    throw new Error("each local pilot role must use a distinct password");
  }
  return target;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$1$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function upsertUser(client, email, digest) {
  const result = await client.query(
    `INSERT INTO "user" (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [email, digest],
  );
  return result.rows[0].id;
}

async function upsertOrganization(client, type, fixture, createdBy) {
  const result = await client.query(
    `INSERT INTO organization (type, display_name, status, idempotency_key, created_by_user_id)
     VALUES ($1, $2, 'ACTIVE', $3, $4)
     ON CONFLICT (idempotency_key) DO UPDATE
       SET display_name = EXCLUDED.display_name, status = 'ACTIVE'
       WHERE organization.type = EXCLUDED.type
     RETURNING id`,
    [type, fixture.orgName, fixture.orgKey, createdBy],
  );
  if (!result.rows[0]) throw new Error(`organization key collision for sanitized ${type} fixture`);
  return result.rows[0].id;
}

async function upsertMembership(client, userId, organizationId, role) {
  await client.query(
    `INSERT INTO membership (user_id, organization_id, role, status)
     VALUES ($1, $2, $3, 'ACTIVE')
     ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'`,
    [userId, organizationId, role],
  );
}

async function seed(environment) {
  const pool = new Pool({ connectionString: environment.GEO_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const migration = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'password_hash'
       ) AS ready`,
    );
    if (!migration.rows[0]?.ready) throw new Error("migration 0009_password_credentials.sql is not applied");

    const f = SANITIZED_RUNTIME_FIXTURES;
    const platformUser = await upsertUser(
      client,
      f.platform.email,
      hashPassword(environment.LOCAL_PLATFORM_ADMIN_PASSWORD),
    );
    const agencyUser = await upsertUser(
      client,
      f.agency.email,
      hashPassword(environment.LOCAL_AGENCY_OWNER_PASSWORD),
    );
    const clientUser = await upsertUser(
      client,
      f.client.email,
      hashPassword(environment.LOCAL_CLIENT_OWNER_PASSWORD),
    );

    const platformOrg = await upsertOrganization(client, "PLATFORM", f.platform, platformUser);
    const agencyOrg = await upsertOrganization(client, "AGENCY", f.agency, platformUser);
    const clientOrg = await upsertOrganization(client, "CLIENT", f.client, platformUser);
    await upsertMembership(client, platformUser, platformOrg, f.platform.role);
    await upsertMembership(client, agencyUser, agencyOrg, f.agency.role);
    await upsertMembership(client, clientUser, clientOrg, f.client.role);

    await client.query(
      `INSERT INTO agency_client_assignment
         (agency_organization_id, client_organization_id, status, assigned_by_user_id)
       SELECT $1, $2, 'ACTIVE', $3
       WHERE NOT EXISTS (
         SELECT 1 FROM agency_client_assignment
          WHERE agency_organization_id = $1 AND client_organization_id = $2 AND status = 'ACTIVE'
       )`,
      [agencyOrg, clientOrg, platformUser],
    );

    const existingProject = await client.query(
      `SELECT id FROM project WHERE client_organization_id = $1 AND name = $2 ORDER BY created_at LIMIT 1`,
      [clientOrg, f.projectName],
    );
    let projectId = existingProject.rows[0]?.id;
    if (!projectId) {
      const created = await client.query(
        `INSERT INTO project (client_organization_id, name, created_by_user_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [clientOrg, f.projectName, platformUser],
      );
      projectId = created.rows[0].id;
    }
    await client.query(
      `INSERT INTO project_membership (project_id, user_id) VALUES ($1, $2)
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [projectId, clientUser],
    );

    // Create minimal KnowledgePackage with content for acceptance testing
    const pkgResult = await client.query(
      `INSERT INTO knowledge_package (id, client_organization_id, project_id, title, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [uuid(), clientOrg, projectId, "本地验收测试知识包", platformUser],
    );
    const pkgId = pkgResult.rows[0]?.id;

    if (pkgId) {
      // Create enterprise profile
      await client.query(
        `INSERT INTO enterprise_profile (id, client_organization_id, legal_name, display_name, industry, description, forbidden_usage, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (client_organization_id) DO UPDATE SET description = EXCLUDED.description`,
        [uuid(), clientOrg, f.client.orgName, "本地验收客户", "企业服务", "提供 GEO 优化、内容营销和数字化转型服务", "虚假承诺", platformUser],
      );

      // Create industry profile (required for opportunity creation)
      await client.query(
        `INSERT INTO industry_profile (id, client_organization_id, project_id, vertical_slug, vertical_label, validation_gate_level, rule_set_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (client_organization_id, project_id) DO NOTHING`,
        [uuid(), clientOrg, projectId, "enterprise-services", "企业服务", "PLATFORM_WIDE_GATE", 1],
      );

      // Create knowledge content document
      const docId = uuid();
      await client.query(
        `INSERT INTO knowledge_document (id, client_organization_id, project_id, package_id, title, source_kind, current_version_number, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'FILE', 1, $6)`,
        [docId, clientOrg, projectId, pkgId, "服务介绍", platformUser],
      );

      const contentHash = createHash("sha256").update(`产品与服务：GEO优化服务, 内容营销服务\n案例：某科技公司 GEO 优化项目\n目标客户：中小企业主\n禁止表达：保证排名第一\n可验证事实：公司成立于 2015 年`).digest("hex");
      const storagePath = `knowledge/${pkgId}/${docId}/${contentHash}`;

      await client.query(
        `INSERT INTO knowledge_version (id, client_organization_id, project_id, package_id, document_id, version_number, storage_path, content_hash, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)`,
        [uuid(), clientOrg, projectId, pkgId, docId, storagePath, contentHash, platformUser],
      );

      await client.query(
        `INSERT INTO knowledge_content (storage_path, content_hash, content_text, client_organization_id, project_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [storagePath, contentHash, `产品与服务：GEO优化服务, 内容营销服务\n案例：某科技公司 GEO 优化项目\n目标客户：中小企业主\n禁止表达：保证排名第一\n可验证事实：公司成立于 2015 年`, clientOrg, projectId],
      );
    }

    const evidence = await client.query(
      `SELECT
         (SELECT count(*)::int FROM "user" WHERE email = ANY($1::text[])) AS users,
         (SELECT count(*)::int FROM organization WHERE id = ANY($2::uuid[])) AS organizations,
         (SELECT count(*)::int FROM membership WHERE user_id = ANY($3::uuid[]) AND status = 'ACTIVE') AS active_memberships,
         (SELECT count(*)::int FROM agency_client_assignment WHERE agency_organization_id = $4 AND client_organization_id = $5 AND status = 'ACTIVE') AS active_assignments,
         (SELECT count(*)::int FROM project WHERE id = $6) AS projects`,
      [
        [f.platform.email, f.agency.email, f.client.email],
        [platformOrg, agencyOrg, clientOrg],
        [platformUser, agencyUser, clientUser],
        agencyOrg,
        clientOrg,
        projectId,
      ],
    );
    await client.query("COMMIT");
    return evidence.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function runSanitizedRuntimeSeed(args = process.argv.slice(2)) {
  const environment = resolveSeedEnvironment();
  validateSeedEnvironment(environment);
  console.log("local-runtime-seed: containment PASS (database=geoplane_local_runtime, host=loopback, provider=OFF)");
  if (args.includes("--validate-only")) return;
  const evidence = await seed(environment);
  console.log("local-runtime-seed: SANITIZED COUNTS");
  console.log(JSON.stringify(evidence));
  console.log("local-runtime-seed: PASS (credentials stored only as versioned scrypt digests)");
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (isMain) {
  runSanitizedRuntimeSeed().catch((error) => {
    console.error(`local-runtime-seed: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
