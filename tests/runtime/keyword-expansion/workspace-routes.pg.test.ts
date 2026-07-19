import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlatformRole, OrganizationType } from "../../../src/contracts/tenancy/entities.js";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { __setAuthRuntimeForTests, createAuthRuntime, type AuthRuntime } from "../../../src/runtime/auth/runtime-context.js";
import { __setGeoRuntimeForTests, createGeoRuntime } from "../../../src/runtime/geo/runtime-context.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { POST as previewRoute } from "../../../src/app/api/keyword-expansion/preview/route.js";
import { GET as listRoute } from "../../../src/app/api/keyword-expansion/projects/[projectId]/route.js";
import { POST as confirmRoute } from "../../../src/app/api/keyword-expansion/candidates/[id]/confirm/route.js";
import { TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH } from "../../helpers/auth-credentials.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
let db: DatabasePort;
let auth: AuthRuntime;

async function identity(email: string, type: OrganizationType, role: PlatformRole, key: string) {
  const user = await db.query<{ id: string }>(`INSERT INTO "user"(email,password_hash) VALUES($1,$2) RETURNING id`, [email, TEST_LOGIN_PASSWORD_HASH]);
  const userId = user.rows[0]!.id;
  const organization = await auth.repos.organizations.createIdempotent({ type, displayName: key, idempotencyKey: key, createdByUserId: userId });
  await auth.repos.memberships.create({ userId, organizationId: organization.id, role });
  return { userId, organizationId: organization.id, email };
}

async function login(email: string) {
  const response = await loginRoute(new Request("http://test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: TEST_LOGIN_PASSWORD }) }));
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

describe.skipIf(testConfig === null)("扩展词与用户问题工作台真实路由", () => {
  beforeAll(async () => {
    db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 6 });
    await applyMigrations(db, migrationsDir);
    auth = createAuthRuntime(db);
    __setAuthRuntimeForTests(auth);
    __setGeoRuntimeForTests(createGeoRuntime(db));
  });
  afterAll(async () => { __setAuthRuntimeForTests(null); __setGeoRuntimeForTests(null); if (db) await db.close(); });
  beforeEach(async () => {
    await db.query(`TRUNCATE keyword_expansion_review_event,keyword_expansion_candidate,keyword_expansion_batch,agency_client_assignment,session,membership,project,organization,"user" RESTART IDENTITY CASCADE`);
  });

  it("客户录入、授权代理商确认、平台读取，并拒绝未授权客户", async () => {
    const client = await identity("exp-client@example.test", "CLIENT", "CLIENT_OWNER", "exp-client");
    const other = await identity("exp-other@example.test", "CLIENT", "CLIENT_OWNER", "exp-other");
    const agency = await identity("exp-agency@example.test", "AGENCY", "AGENCY_OWNER", "exp-agency");
    const platform = await identity("exp-platform@example.test", "PLATFORM", "PLATFORM_SUPER_ADMIN", "exp-platform");
    const project = await auth.repos.projects.create({ clientOrganizationId: client.organizationId, name: "客户项目", createdByUserId: client.userId });
    await auth.repos.agencyClientAssignments.assign({ agencyOrganizationId: agency.organizationId, clientOrganizationId: client.organizationId, assignedByUserId: platform.userId });
    const [clientCookie, otherCookie, agencyCookie, platformCookie] = await Promise.all([login(client.email), login(other.email), login(agency.email), login(platform.email)]);

    const preview = await previewRoute(new Request("http://test/api/keyword-expansion/preview", { method: "POST", headers: { cookie: clientCookie, "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, reason: "整理客户真实问题", groups: [{ type: "MAIN", values: ["企业 GEO"] }, { type: "QUESTION", values: ["{keyword} 如何实施？"] }] }) }));
    expect(preview.status).toBe(201);
    const created = await preview.json();
    const candidateId: string = created.data.candidates[0].id;
    expect(await db.query(`SELECT 1 FROM keyword_expansion_candidate WHERE id=$1`, [candidateId])).toMatchObject({ rowCount: 1 });

    const denied = (await listRoute(new Request(`http://test/api/keyword-expansion/projects/${project.id}`, { headers: { cookie: otherCookie } }), { params: Promise.resolve({ projectId: project.id }) }))!;
    expect(denied.status).toBe(403);
    for (const cookie of [agencyCookie, platformCookie]) {
      const readable = (await listRoute(new Request(`http://test/api/keyword-expansion/projects/${project.id}`, { headers: { cookie } }), { params: Promise.resolve({ projectId: project.id }) }))!;
      expect(readable.status).toBe(200);
      expect((await readable.json()).data[0].candidates[0].question).toBe("企业 GEO 如何实施？");
    }

    const confirmed = await confirmRoute(new Request(`http://test/api/keyword-expansion/candidates/${candidateId}/confirm`, { method: "POST", headers: { cookie: agencyCookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "代理商人工确认" }) }), { params: Promise.resolve({ id: candidateId }) });
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).data.status).toBe("CONFIRMED");
    const persisted = (await listRoute(new Request(`http://test/api/keyword-expansion/projects/${project.id}`, { headers: { cookie: clientCookie } }), { params: Promise.resolve({ projectId: project.id }) }))!;
    expect((await persisted.json()).data[0].candidates[0].status).toBe("CONFIRMED");
  });
});
