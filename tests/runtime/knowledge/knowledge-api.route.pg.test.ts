/**
 * Real-Postgres route tests for KNOWLEDGE_API_V1 (Agent D3).
 *
 * These exercise the knowledge App Router handlers end-to-end against GEO_TEST_DATABASE_URL. They
 * seed users/orgs/memberships through the real repositories, obtain a real session cookie via the
 * auth login route, inject a knowledge runtime pointed at the throwaway test database, then invoke
 * the exported handlers with `new Request(...)` and assert HTTP status + JSON.
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
 *
 * Coverage:
 *   - POST create package -> 201 with counts 0
 *   - POST upload a TXT file -> 200 INGESTED, version 1, package documentCount 1
 *   - client-surface leak check: the ingest response body carries no storage/hash/chunk internals
 *   - GET package -> counts reflect the ingest + a seeded issue
 *   - GET issues -> the frozen issue view
 *   - POST confirm -> CONFIRMED
 *   - cross-tenant GET of another client's package -> 403
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
import { TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH } from "../../helpers/auth-credentials.js";
import { POST as createPackageRoute } from "../../../src/app/api/projects/[projectId]/knowledge/packages/route.js";
import { POST as uploadFileRoute } from "../../../src/app/api/knowledge/packages/[id]/files/route.js";
import { GET as getPackageRoute } from "../../../src/app/api/knowledge/packages/[id]/route.js";
import { GET as getIssuesRoute } from "../../../src/app/api/knowledge/packages/[id]/issues/route.js";
import { POST as confirmRoute } from "../../../src/app/api/knowledge/packages/[id]/confirm/route.js";

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
  await db.query(`UPDATE "user" SET password_hash = $2 WHERE lower(email) = lower($1)`, [
    email,
    TEST_LOGIN_PASSWORD_HASH,
  ]);
  const res = await loginRoute(
    new Request("http://test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_LOGIN_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a cookie");
  return setCookie.split(";")[0]!;
}

describe.skipIf(testConfig === null)("KNOWLEDGE_API_V1 — routes over real Postgres", () => {
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
      `TRUNCATE knowledge_snapshot, knowledge_issue, knowledge_version,
                knowledge_document, knowledge_package, enterprise_profile,
                session, membership, project, organization, "user"
       RESTART IDENTITY CASCADE`,
    );
  });

  it("creates a package, ingests a TXT file, reads counts/issues, confirms; and blocks cross-tenant", async () => {
    const owner = await createUser("owner@example.test");
    const clientA = await createClientOrg("client-a", "Client A", owner);
    await createMembership(owner, clientA, "CLIENT_OWNER");
    const projectA = await createProject(clientA, owner, "Project A");
    const cookieA = await loginAndGetCookie("owner@example.test");

    // 1. Create a package under the project.
    const createRes = await createPackageRoute(
      new Request(`http://test/api/projects/${projectA}/knowledge/packages`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ title: "Enterprise KB", classification: "CONFIDENTIAL" }),
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.ok).toBe(true);
    expect(created.data.status).toBe("DRAFT");
    expect(created.data.documentCount).toBe(0);
    expect(created.data.openIssueCount).toBe(0);
    const packageId: string = created.data.id;

    // 2. Upload a TXT file -> a version is appended.
    const fileText = "Acme Corp sells industrial widgets since 1998.";
    const uploadRes = await uploadFileRoute(
      new Request(`http://test/api/knowledge/packages/${packageId}/files`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({
          filename: "overview.txt",
          contentType: "text/plain",
          contentBase64: Buffer.from(fileText, "utf8").toString("base64"),
        }),
      }),
      { params: Promise.resolve({ id: packageId }) },
    );
    expect(uploadRes.status).toBe(200);
    const uploadBodyText = await uploadRes.text();
    const uploaded = JSON.parse(uploadBodyText);
    expect(uploaded.ok).toBe(true);
    expect(uploaded.data.outcome).toBe("INGESTED");
    expect(uploaded.data.format).toBe("TXT");
    expect(uploaded.data.document.title).toBe("overview.txt");
    expect(uploaded.data.version.versionNumber).toBe(1);
    expect(uploaded.data.package.documentCount).toBe(1);

    // Client-surface leak check: no storage/hash/chunk/embedding internals in the response.
    for (const banned of [
      "storagePath",
      "storage_path",
      "contentHash",
      "content_hash",
      "chunk",
      "embedding",
      "artifactHash",
      "artifact_hash",
    ]) {
      expect(uploadBodyText).not.toContain(banned);
    }

    // Seed an open issue directly to prove the counts + issue view.
    await knowledgeRuntime.knowledge.issues.create({
      clientOrganizationId: clientA,
      projectId: projectA,
      packageId,
      kind: "MISSING_INFORMATION",
      message: "Pricing page is not covered.",
      createdByUserId: owner,
      severity: "BLOCKER",
    });

    // 3. GET the package -> counts reflect the document + open issue.
    const getRes = await getPackageRoute(
      new Request(`http://test/api/knowledge/packages/${packageId}`, {
        headers: { cookie: cookieA },
      }),
      { params: Promise.resolve({ id: packageId }) },
    );
    expect(getRes.status).toBe(200);
    const got = await getRes.json();
    expect(got.data.documentCount).toBe(1);
    expect(got.data.openIssueCount).toBe(1);

    // 4. GET issues -> the frozen issue view.
    const issuesRes = await getIssuesRoute(
      new Request(`http://test/api/knowledge/packages/${packageId}/issues`, {
        headers: { cookie: cookieA },
      }),
      { params: Promise.resolve({ id: packageId }) },
    );
    expect(issuesRes.status).toBe(200);
    const issuesBody = await issuesRes.json();
    expect(issuesBody.data).toHaveLength(1);
    expect(issuesBody.data[0]).toMatchObject({
      packageId,
      kind: "MISSING_INFORMATION",
      severity: "BLOCKER",
      resolved: false,
    });

    // 5. Confirm the package.
    const confirmRes = await confirmRoute(
      new Request(`http://test/api/knowledge/packages/${packageId}/confirm`, {
        method: "POST",
        headers: { cookie: cookieA },
      }),
      { params: Promise.resolve({ id: packageId }) },
    );
    expect(confirmRes.status).toBe(200);
    const confirmed = await confirmRes.json();
    expect(confirmed.data.status).toBe("CONFIRMED");
    expect(confirmed.data.confirmedAt).not.toBeNull();

    // 6. Cross-tenant: a different client's owner cannot read client A's package -> 403.
    const intruder = await createUser("intruder@example.test");
    const clientB = await createClientOrg("client-b", "Client B", intruder);
    await createMembership(intruder, clientB, "CLIENT_OWNER");
    const cookieB = await loginAndGetCookie("intruder@example.test");

    const forbiddenRes = await getPackageRoute(
      new Request(`http://test/api/knowledge/packages/${packageId}`, {
        headers: { cookie: cookieB },
      }),
      { params: Promise.resolve({ id: packageId }) },
    );
    expect(forbiddenRes.status).toBe(403);
    const forbidden = await forbiddenRes.json();
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error.code).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated create -> 401", async () => {
    const res = await createPackageRoute(
      new Request("http://test/api/projects/some-project/knowledge/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "No auth" }),
      }),
      { params: Promise.resolve({ projectId: "some-project" }) },
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });
});
