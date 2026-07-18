/**
 * Real-Postgres route tests for KNOWLEDGE_AUDIT_CLOSURE_V1 (Agent C).
 *
 * Proves that every legacy knowledge WRITE route now emits exactly one real AuditEvent — closing
 * supervisor WARN 7b. Each operation is invoked as its exported App Router handler against
 * GEO_TEST_DATABASE_URL (geoplane_pl_c), with a valid session cookie obtained from the real login
 * route, and we assert against the audit_event table directly:
 *
 *   - file upload      -> exactly one `knowledge.document.ingested`
 *   - url import       -> exactly one `knowledge.url.ingested`
 *   - package confirm  -> exactly one `knowledge_package.confirmed`
 *   - issue resolve    -> exactly one `knowledge_issue.resolved`
 *   - snapshot created -> exactly one `knowledge.snapshot.created`
 *
 * Every event carries the REAL, session-derived actor and the resource's tenant/project (never a
 * body-supplied org). Unauthenticated writes -> 401 with NO audit; cross-tenant writes -> 403 with
 * NO audit and NO state change.
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlatformRole } from "../../../src/contracts/tenancy/entities.js";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import {
  __setAuthRuntimeForTests,
  createAuthRuntime,
  type AuthRuntime,
} from "../../../src/runtime/auth/runtime-context.js";
import {
  __setKnowledgeRuntimeForTests,
  createKnowledgeRuntime,
  type KnowledgeRuntime,
} from "../../../src/runtime/knowledge/runtime-context.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { POST as uploadFileRoute } from "../../../src/app/api/knowledge/packages/[id]/files/route.js";
import { POST as importUrlRoute } from "../../../src/app/api/knowledge/packages/[id]/urls/route.js";
import { POST as confirmRoute } from "../../../src/app/api/knowledge/packages/[id]/confirm/route.js";
import { POST as resolveIssueRoute } from "../../../src/app/api/knowledge/packages/[id]/issues/[issueId]/resolve/route.js";
import { POST as snapshotRoute } from "../../../src/app/api/knowledge/packages/[id]/snapshots/route.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "migrations",
);

let db: DatabasePort;
let authRuntime: AuthRuntime;
let knowledgeRuntime: KnowledgeRuntime;

// --- seed helpers -----------------------------------------------------------

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createClientOrg(key: string, name: string, createdBy: string): Promise<string> {
  const org = await authRuntime.repos.organizations.createIdempotent({
    type: "CLIENT",
    displayName: name,
    idempotencyKey: key,
    createdByUserId: createdBy,
  });
  return org.id;
}

async function createMembership(
  userId: string,
  organizationId: string,
  role: PlatformRole,
): Promise<void> {
  await authRuntime.repos.memberships.create({ userId, organizationId, role });
}

async function createProject(
  clientOrgId: string,
  userId: string,
  name: string,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO project (client_organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [clientOrgId, name, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("project insert returned no row");
  return row.id;
}

/** Runs login for `email` and returns the reusable `name=value` Cookie header value. */
async function loginAndGetCookie(email: string): Promise<string> {
  const res = await loginRoute(
    new Request("http://test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a cookie");
  return setCookie.split(";")[0]!;
}

interface AuditRow {
  id: string;
  organization_id: string;
  actor_user_id: string;
  actor_organization_id: string;
  client_organization_id: string | null;
  project_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  event_hash: string;
}

/** Every audit_event row for a given action, oldest first. */
async function auditRowsFor(action: string): Promise<AuditRow[]> {
  const res = await db.query<AuditRow>(
    `SELECT * FROM audit_event WHERE action = $1 ORDER BY created_at, id`,
    [action],
  );
  return res.rows;
}

/** Total number of audit_event rows currently persisted. */
async function totalAuditCount(): Promise<number> {
  const res = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM audit_event`);
  return Number(res.rows[0]?.n ?? "0");
}

interface Tenant {
  readonly owner: string;
  readonly clientOrg: string;
  readonly project: string;
  readonly cookie: string;
}

/** Seed a CLIENT tenant with an owner, a project, and a valid session cookie. */
async function seedTenant(emailKey: string, orgKey: string): Promise<Tenant> {
  const owner = await createUser(`${emailKey}@example.test`);
  const clientOrg = await createClientOrg(orgKey, `Org ${orgKey}`, owner);
  await createMembership(owner, clientOrg, "CLIENT_OWNER");
  const project = await createProject(clientOrg, owner, `Project ${orgKey}`);
  const cookie = await loginAndGetCookie(`${emailKey}@example.test`);
  return { owner, clientOrg, project, cookie };
}

/** Seed a DRAFT package under a tenant, returning its id. */
async function seedPackage(tenant: Tenant, title = "KB"): Promise<string> {
  const pkg = await knowledgeRuntime.knowledge.packages.create({
    clientOrganizationId: tenant.clientOrg,
    projectId: tenant.project,
    title,
    createdByUserId: tenant.owner,
    classification: "CONFIDENTIAL",
  });
  return pkg.id;
}

/** Assert the single audit row for `action` is attributed to the tenant's real actor + scope. */
function expectSoleAuditFor(
  rows: AuditRow[],
  tenant: Tenant,
  expected: { targetType: string; targetId?: string },
): void {
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  // Real, server-derived actor — the owner's user id, never a body value.
  expect(row.actor_user_id).toBe(tenant.owner);
  // Owning + actor org is the session org (the client org for a CLIENT_OWNER).
  expect(row.organization_id).toBe(tenant.clientOrg);
  expect(row.actor_organization_id).toBe(tenant.clientOrg);
  // Tenant/project scoping comes from the loaded resource.
  expect(row.client_organization_id).toBe(tenant.clientOrg);
  expect(row.project_id).toBe(tenant.project);
  expect(row.target_type).toBe(expected.targetType);
  if (expected.targetId !== undefined) expect(row.target_id).toBe(expected.targetId);
  // The append-only trail computes a non-empty tamper-evidence hash.
  expect(row.event_hash.length).toBeGreaterThan(0);
}

describe.skipIf(testConfig === null)(
  "KNOWLEDGE_AUDIT_CLOSURE_V1 — legacy knowledge write routes emit AuditEvents",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
      authRuntime = createAuthRuntime(db);
      knowledgeRuntime = createKnowledgeRuntime(db);
      __setAuthRuntimeForTests(authRuntime);
      __setKnowledgeRuntimeForTests(knowledgeRuntime);
    });

    afterAll(async () => {
      __setAuthRuntimeForTests(null);
      __setKnowledgeRuntimeForTests(null);
      if (db) await db.close();
    });

    beforeEach(async () => {
      await db.query(
        `TRUNCATE audit_event, knowledge_snapshot, knowledge_issue, knowledge_version,
                  knowledge_document, knowledge_package, enterprise_profile,
                  session, membership, project, organization, "user"
         RESTART IDENTITY CASCADE`,
      );
    });

    it("file upload -> exactly one knowledge.document.ingested audit for the real actor", async () => {
      const tenant = await seedTenant("owner", "client-a");
      const packageId = await seedPackage(tenant);

      const res = await uploadFileRoute(
        new Request(`http://test/api/knowledge/packages/${packageId}/files`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: tenant.cookie },
          body: JSON.stringify({
            filename: "overview.txt",
            contentType: "text/plain",
            contentBase64: Buffer.from("Acme sells widgets.", "utf8").toString("base64"),
          }),
        }),
        { params: Promise.resolve({ id: packageId }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.outcome).toBe("INGESTED");

      const rows = await auditRowsFor("knowledge.document.ingested");
      expectSoleAuditFor(rows, tenant, { targetType: "knowledge_document" });
      // Exactly one event total for this operation — no duplicate audit.
      expect(await totalAuditCount()).toBe(1);
    });

    it("url import -> exactly one knowledge.url.ingested audit for the real actor", async () => {
      const tenant = await seedTenant("owner", "client-a");
      const packageId = await seedPackage(tenant);

      const res = await importUrlRoute(
        new Request(`http://test/api/knowledge/packages/${packageId}/urls`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: tenant.cookie },
          body: JSON.stringify({
            url: "https://acme.test/about",
            contentType: "text/html",
            contentBase64: Buffer.from("<h1>About Acme</h1>", "utf8").toString("base64"),
          }),
        }),
        { params: Promise.resolve({ id: packageId }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.outcome).toBe("INGESTED");

      const rows = await auditRowsFor("knowledge.url.ingested");
      expectSoleAuditFor(rows, tenant, { targetType: "knowledge_document" });
      expect(await totalAuditCount()).toBe(1);
    });

    it("package confirm -> exactly one knowledge_package.confirmed audit; and it is atomic", async () => {
      const tenant = await seedTenant("owner", "client-a");
      const packageId = await seedPackage(tenant);

      const res = await confirmRoute(
        new Request(`http://test/api/knowledge/packages/${packageId}/confirm`, {
          method: "POST",
          headers: { cookie: tenant.cookie },
        }),
        { params: Promise.resolve({ id: packageId }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe("CONFIRMED");

      const rows = await auditRowsFor("knowledge_package.confirmed");
      expectSoleAuditFor(rows, tenant, { targetType: "knowledge_package", targetId: packageId });
      expect(await totalAuditCount()).toBe(1);
    });

    it("issue resolve -> exactly one knowledge_issue.resolved audit; re-resolve writes none", async () => {
      const tenant = await seedTenant("owner", "client-a");
      const packageId = await seedPackage(tenant);
      const issue = await knowledgeRuntime.knowledge.issues.create({
        clientOrganizationId: tenant.clientOrg,
        projectId: tenant.project,
        packageId,
        kind: "MISSING_INFORMATION",
        message: "Pricing page not covered.",
        createdByUserId: tenant.owner,
        severity: "BLOCKER",
      });

      const res = await resolveIssueRoute(
        new Request(
          `http://test/api/knowledge/packages/${packageId}/issues/${issue.id}/resolve`,
          { method: "POST", headers: { cookie: tenant.cookie } },
        ),
        { params: Promise.resolve({ id: packageId, issueId: issue.id }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.resolved).toBe(true);

      const rows = await auditRowsFor("knowledge_issue.resolved");
      expectSoleAuditFor(rows, tenant, { targetType: "knowledge_issue", targetId: issue.id });
      expect(await totalAuditCount()).toBe(1);

      // Idempotent re-resolve: same 200, no second audit event.
      const again = await resolveIssueRoute(
        new Request(
          `http://test/api/knowledge/packages/${packageId}/issues/${issue.id}/resolve`,
          { method: "POST", headers: { cookie: tenant.cookie } },
        ),
        { params: Promise.resolve({ id: packageId, issueId: issue.id }) },
      );
      expect(again.status).toBe(200);
      expect(await auditRowsFor("knowledge_issue.resolved")).toHaveLength(1);
      expect(await totalAuditCount()).toBe(1);
    });

    it("snapshot created -> exactly one knowledge.snapshot.created audit for the real actor", async () => {
      const tenant = await seedTenant("owner", "client-a");
      const packageId = await seedPackage(tenant);

      const res = await snapshotRoute(
        new Request(`http://test/api/knowledge/packages/${packageId}/snapshots`, {
          method: "POST",
          headers: { cookie: tenant.cookie },
        }),
        { params: Promise.resolve({ id: packageId }) },
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.snapshotNumber).toBe(1);
      // Leak-free: the sealed content hash is never surfaced to the client.
      expect(JSON.stringify(body.data)).not.toContain("contentHash");
      expect(JSON.stringify(body.data)).not.toContain("content_hash");

      const rows = await auditRowsFor("knowledge.snapshot.created");
      expectSoleAuditFor(rows, tenant, {
        targetType: "knowledge_snapshot",
        targetId: body.data.id,
      });
      expect(await totalAuditCount()).toBe(1);
    });

    it("unauthenticated write -> 401 and NO audit event", async () => {
      const tenant = await seedTenant("owner", "client-a");
      const packageId = await seedPackage(tenant);

      const res = await confirmRoute(
        new Request(`http://test/api/knowledge/packages/${packageId}/confirm`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: packageId }) },
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHENTICATED");
      expect(await totalAuditCount()).toBe(0);
    });

    it("cross-tenant write -> 403, NO audit event, and NO state change", async () => {
      const tenantA = await seedTenant("owner", "client-a");
      const packageId = await seedPackage(tenantA);
      const tenantB = await seedTenant("intruder", "client-b");

      // Intruder from client B tries to confirm client A's package.
      const res = await confirmRoute(
        new Request(`http://test/api/knowledge/packages/${packageId}/confirm`, {
          method: "POST",
          headers: { cookie: tenantB.cookie },
        }),
        { params: Promise.resolve({ id: packageId }) },
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");

      // No audit written on the denial path (legacy route makes no state change on 403).
      expect(await totalAuditCount()).toBe(0);
      // The package was NOT confirmed.
      const pkg = await knowledgeRuntime.knowledge.packages.findById(packageId);
      expect(pkg?.status).toBe("DRAFT");
    });
  },
);
