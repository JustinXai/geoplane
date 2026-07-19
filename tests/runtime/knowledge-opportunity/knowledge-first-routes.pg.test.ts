import { randomUUID } from "node:crypto";
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
import { __setGeoRuntimeForTests, createGeoRuntime } from "../../../src/runtime/geo/runtime-context.js";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "../../../src/runtime/knowledge/runtime-context.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { POST as previewRoute } from "../../../src/app/api/projects/[projectId]/knowledge-opportunities/preview/route.js";
import { POST as confirmRoute } from "../../../src/app/api/commands/projects/[projectId]/knowledge-opportunities/route.js";
import { TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH } from "../../helpers/auth-credentials.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
let db: DatabasePort;
let auth: AuthRuntime;
let knowledge: KnowledgeRuntime;

async function clientIdentity(email: string, key: string) {
  const user = await db.query<{ id: string }>(
    `INSERT INTO "user"(email,password_hash) VALUES($1,$2) RETURNING id`,
    [email, TEST_LOGIN_PASSWORD_HASH],
  );
  const userId = user.rows[0]!.id;
  const organization = await auth.repos.organizations.createIdempotent({
    type: "CLIENT",
    displayName: key,
    idempotencyKey: key,
    createdByUserId: userId,
  });
  const role: PlatformRole = "CLIENT_OWNER";
  await auth.repos.memberships.create({ userId, organizationId: organization.id, role });
  return { userId, organizationId: organization.id, email };
}

async function login(email: string): Promise<string> {
  const response = await loginRoute(new Request("http://test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: TEST_LOGIN_PASSWORD }),
  }));
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function seedKnowledge(identity: Awaited<ReturnType<typeof clientIdentity>>, withIndustry = true) {
  const project = await auth.repos.projects.create({
    clientOrganizationId: identity.organizationId,
    name: "客户增长项目",
    createdByUserId: identity.userId,
  });
  await knowledge.knowledge.enterpriseProfiles.upsert({
    clientOrganizationId: identity.organizationId,
    legalName: "华东智造有限公司",
    actingUserId: identity.userId,
    industry: "工业设备运维",
    description: "为工业企业提供设备预测性维护服务。",
    forbiddenUsage: "保证零故障",
  });
  const pkg = await knowledge.knowledge.packages.create({
    clientOrganizationId: identity.organizationId,
    projectId: project.id,
    title: "企业知识库",
    createdByUserId: identity.userId,
  });
  const ingested = await knowledge.ingestion.ingest({
    clientOrganizationId: identity.organizationId,
    projectId: project.id,
    packageId: pkg.id,
    title: "企业业务资料.txt",
    createdByUserId: identity.userId,
    source: {
      filename: "企业业务资料.txt",
      contentType: "text/plain",
      bytes: Buffer.from([
        "产品与服务：设备预测性维护平台、现场诊断服务",
        "客户案例：某零部件工厂减少非计划停机时间",
        "目标人群：工厂设备负责人",
        "地域：长三角",
        "业务目标：降低非计划停机风险",
        "差异化能力：兼容存量设备",
        "可验证事实：支持边缘采集接入",
        "Q：部署预测性维护需要改造现有设备吗",
        "A：可通过边缘采集适配现有设备",
      ].join("\n"), "utf8"),
    },
  });
  expect(ingested.outcome).toBe("INGESTED");
  if (withIndustry) {
    await db.query(
      `INSERT INTO industry_profile
        (id,client_organization_id,project_id,vertical_slug,vertical_label,validation_gate_level,rule_set_version)
       VALUES($1,$2,$3,'industrial-maintenance','工业设备运维','INDUSTRY_VERTICAL_GATE',1)`,
      [randomUUID(), identity.organizationId, project.id],
    );
  }
  return { project, pkg };
}

describe.skipIf(testConfig === null)("knowledge-first 用户可用路由", () => {
  beforeAll(async () => {
    db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
    await applyMigrations(db, migrationsDir);
    auth = createAuthRuntime(db);
    knowledge = createKnowledgeRuntime(db);
    __setAuthRuntimeForTests(auth);
    __setGeoRuntimeForTests(createGeoRuntime(db));
  });

  afterAll(async () => {
    __setAuthRuntimeForTests(null);
    __setGeoRuntimeForTests(null);
    if (db) await db.close();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE audit_event,opportunity,keyword_question_map,industry_profile,
        demand_evidence,keyword_decision_v2,keyword_review_package_item_v2,keyword_review_package_v2,
        keyword_record,keyword_import_batch,keyword_dataset,
        knowledge_content,knowledge_version,knowledge_document,knowledge_package,enterprise_profile,
        agency_client_assignment,session,membership,project,organization,"user"
       RESTART IDENTITY CASCADE`,
    );
  });

  it("无关键词数据时生成真实知识问题，刷新结果稳定，并由人工确认创建 Opportunity", async () => {
    const client = await clientIdentity("knowledge-first@example.test", "knowledge-first-client");
    const { project, pkg } = await seedKnowledge(client);
    const cookie = await login(client.email);
    const previewRequest = () => new Request(
      `http://test/api/projects/${project.id}/knowledge-opportunities/preview`,
      { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" },
    );
    const first = await previewRoute(previewRequest(), { params: Promise.resolve({ projectId: project.id }) });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.data.knowledgePackageId).toBe(pkg.id);
    expect(firstBody.data.candidates.length).toBeGreaterThan(0);
    expect(firstBody.data.candidates[0].demandClaim).toBe("NOT_ASSERTED");
    expect(JSON.stringify(firstBody)).not.toContain("CONFIRMED_DEMAND");

    const refreshed = await previewRoute(previewRequest(), { params: Promise.resolve({ projectId: project.id }) });
    const refreshedBody = await refreshed.json();
    expect(refreshedBody.data.candidates.map((item: { id: string }) => item.id))
      .toEqual(firstBody.data.candidates.map((item: { id: string }) => item.id));

    const candidate = firstBody.data.candidates[0];
    const confirmRequest = () => new Request(
      `http://test/api/commands/projects/${project.id}/knowledge-opportunities`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "Idempotency-Key": `knowledge-first-${candidate.id}`,
        },
        body: JSON.stringify({ candidateId: candidate.id, knowledgePackageId: pkg.id }),
      },
    );
    const confirmed = await confirmRoute(confirmRequest(), { params: Promise.resolve({ projectId: project.id }) });
    expect(confirmed.status).toBe(201);
    expect((await confirmed.json()).data.status).toBe("CREATED");
    const replayed = await confirmRoute(confirmRequest(), { params: Promise.resolve({ projectId: project.id }) });
    expect(replayed.status).toBe(201);
    expect((await db.query(`SELECT 1 FROM opportunity WHERE project_id=$1`, [project.id])).rowCount).toBe(1);
  });

  it("跨租户预览和确认均返回 403", async () => {
    const owner = await clientIdentity("owner-scope@example.test", "owner-scope");
    const outsider = await clientIdentity("outsider-scope@example.test", "outsider-scope");
    const { project, pkg } = await seedKnowledge(owner);
    const ownerCookie = await login(owner.email);
    const outsiderCookie = await login(outsider.email);
    const ownerPreview = await previewRoute(new Request("http://test/preview", {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}",
    }), { params: Promise.resolve({ projectId: project.id }) });
    const candidateId = (await ownerPreview.json()).data.candidates[0].id;

    const deniedPreview = await previewRoute(new Request("http://test/preview", {
      method: "POST", headers: { cookie: outsiderCookie, "content-type": "application/json" }, body: "{}",
    }), { params: Promise.resolve({ projectId: project.id }) });
    expect(deniedPreview.status).toBe(403);
    const deniedConfirm = await confirmRoute(new Request("http://test/confirm", {
      method: "POST",
      headers: { cookie: outsiderCookie, "content-type": "application/json" },
      body: JSON.stringify({ candidateId, knowledgePackageId: pkg.id }),
    }), { params: Promise.resolve({ projectId: project.id }) });
    expect(deniedConfirm.status).toBe(403);
    expect((await db.query(`SELECT 1 FROM opportunity WHERE project_id=$1`, [project.id])).rowCount).toBe(0);
  });

  it("人工关键词仅增强问题且不产生需求指标，确认由服务端重建并持久化", async () => {
    const client = await clientIdentity("manual-seed@example.test", "manual-seed-client");
    const { project, pkg } = await seedKnowledge(client);
    const cookie = await login(client.email);
    const datasetId = randomUUID();
    const recordId = randomUUID();
    await db.query(
      `INSERT INTO keyword_dataset
        (id,client_organization_id,project_id,name,source_kind,status,created_by_user_id,created_at)
       VALUES($1,$2,$3,'人工补充词','MANUAL','ACTIVE',$4,now())`,
      [datasetId, client.organizationId, project.id, client.userId],
    );
    await db.query(
      `INSERT INTO keyword_record
        (id,client_organization_id,project_id,dataset_id,keyword,normalized_keyword,source_kind,created_by_user_id,created_at)
       VALUES($1,$2,$3,$4,'工厂设备故障预警','工厂设备故障预警','MANUAL',$5,now())`,
      [recordId, client.organizationId, project.id, datasetId, client.userId],
    );

    const preview = await previewRoute(new Request("http://test/preview", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        optionalKeywordSeeds: [{
          text: "伪造需求词",
          origin: "DATASET",
          evidence: [{ field: "fake", value: 999, sourceLabel: "浏览器", verified: true }],
        }],
      }),
    }), { params: Promise.resolve({ projectId: project.id }) });
    expect(preview.status).toBe(200);
    const batch = (await preview.json()).data;
    const candidate = batch.candidates.find((item: { seed?: { text: string } }) =>
      item.seed?.text === "工厂设备故障预警");
    expect(candidate.seed.origin).toBe("MANUAL");
    expect(candidate.seed.verifiedEvidence).toEqual([]);
    expect(JSON.stringify(batch)).not.toContain("伪造需求词");
    expect(JSON.stringify(batch)).not.toContain("CONFIRMED_DEMAND");

    const request = () => new Request("http://test/confirm", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "Idempotency-Key": `manual-enhancement-${candidate.id}`,
      },
      body: JSON.stringify({
        candidateId: candidate.id,
        knowledgePackageId: pkg.id,
        optionalKeywordSeeds: [{ text: "伪造替换词", origin: "MANUAL" }],
      }),
    });
    expect((await confirmRoute(request(), { params: Promise.resolve({ projectId: project.id }) })).status).toBe(201);
    expect((await confirmRoute(request(), { params: Promise.resolve({ projectId: project.id }) })).status).toBe(201);
    const stored = await db.query<{ keyword: string }>(`SELECT keyword FROM opportunity WHERE project_id=$1`, [project.id]);
    expect(stored.rows).toEqual([{ keyword: "工厂设备故障预警" }]);
  });

  it("通用文件关键词可携带独立真实证据，不要求百度字段且仍不宣称确认需求", async () => {
    const client = await clientIdentity("generic-evidence@example.test", "generic-evidence-client");
    const { project } = await seedKnowledge(client);
    const cookie = await login(client.email);
    const datasetId = randomUUID();
    const batchId = randomUUID();
    const recordId = randomUUID();
    await db.query(
      `INSERT INTO keyword_dataset
        (id,client_organization_id,project_id,name,source_kind,status,created_by_user_id,created_at)
       VALUES($1,$2,$3,'客户咨询统计','GENERIC_FILE','ACTIVE',$4,now())`,
      [datasetId, client.organizationId, project.id, client.userId],
    );
    await db.query(
      `INSERT INTO keyword_import_batch
        (id,client_organization_id,project_id,dataset_id,source_kind,source_format,source_file_name,
         manifest_hash,status,accepted_count,rejected_count,imported_by_user_id,imported_at)
       VALUES($1,$2,$3,$4,'GENERIC_FILE','CSV','customer-inquiries.csv',$5,'COMPLETED',1,0,$6,now())`,
      [batchId, client.organizationId, project.id, datasetId, "c".repeat(64), client.userId],
    );
    await db.query(
      `INSERT INTO keyword_record
        (id,client_organization_id,project_id,dataset_id,import_batch_id,keyword,normalized_keyword,
         source_kind,created_by_user_id,created_at)
       VALUES($1,$2,$3,$4,$5,'预测性维护方案','预测性维护方案','GENERIC_FILE',$6,now())`,
      [recordId, client.organizationId, project.id, datasetId, batchId, client.userId],
    );
    await db.query(
      `INSERT INTO demand_evidence
        (id,client_organization_id,project_id,keyword_record_id,source_kind,metric_kind,metric_value,
         metric_unit,source_reference,observed_at,recorded_at)
       VALUES($1,$2,$3,$4,'GENERIC_FILE','customer_inquiry_count',12,'次','customer-crm-export',
              '2026-06-30T00:00:00.000Z',now())`,
      [randomUUID(), client.organizationId, project.id, recordId],
    );

    const preview = await previewRoute(new Request("http://test/preview", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}",
    }), { params: Promise.resolve({ projectId: project.id }) });
    expect(preview.status).toBe(200);
    const batch = (await preview.json()).data;
    const candidate = batch.candidates.find((item: { seed?: { text: string } }) =>
      item.seed?.text === "预测性维护方案");
    expect(candidate.seed.origin).toBe("DATASET");
    expect(candidate.seed.verifiedEvidence).toEqual([
      expect.objectContaining({ field: "customer_inquiry_count", value: 12, verified: true }),
    ]);
    expect(candidate.demandClaim).toBe("NOT_ASSERTED");
    expect(JSON.stringify(candidate)).not.toMatch(/BAIDU_DEMAND_INDEX|CONFIRMED_DEMAND/);
  });

  it("缺少真实行业前置时保留预览能力并明确拒绝伪造确认", async () => {
    const client = await clientIdentity("no-industry@example.test", "no-industry");
    const { project, pkg } = await seedKnowledge(client, false);
    const cookie = await login(client.email);
    const preview = await previewRoute(new Request("http://test/preview", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}",
    }), { params: Promise.resolve({ projectId: project.id }) });
    expect(preview.status).toBe(200);
    const candidateId = (await preview.json()).data.candidates[0].id;
    const confirm = await confirmRoute(new Request("http://test/confirm", {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ candidateId, knowledgePackageId: pkg.id }),
    }), { params: Promise.resolve({ projectId: project.id }) });
    expect(confirm.status).toBe(409);
    expect((await confirm.json()).error.message).toContain("行业规则尚未确认");
    expect((await db.query(`SELECT 1 FROM opportunity WHERE project_id=$1`, [project.id])).rowCount).toBe(0);
  });
});
