import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { AgencyDeliveryControlService } from "../../../src/runtime/agency-delivery/delivery-control.js";
import { buildAgencyPortfolioSummary } from "../../../src/runtime/agency-delivery/read-model.js";
import { createAgencyDeliveryRuntime } from "../../../src/runtime/agency-delivery/runtime-context.js";

const config = loadDatabaseConfig({ test: true });
let db: DatabasePort;
let agencyId = "";
let clientA = "";
let clientB = "";
let projectA = "";
let actorId = "";

async function insertOrganization(type: "AGENCY" | "CLIENT", name: string): Promise<string> {
  const row = await db.query<{ id: string }>(
    `INSERT INTO organization(type,display_name,idempotency_key,created_by_user_id)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [type, name, randomUUID(), actorId],
  );
  return row.rows[0]!.id;
}

describe.skipIf(config === null)("agency delivery PostgreSQL tenant scope", () => {
  beforeAll(async () => {
    db = createPgDatabase({ connectionString: config!.connectionString, max: 2 });
    await db.query("DROP SCHEMA public CASCADE");
    await db.query("CREATE SCHEMA public");
    await applyMigrations(db, "migrations");

    const user = await db.query<{ id: string }>(
      `INSERT INTO "user"(email) VALUES($1) RETURNING id`,
      [`agency-scope-${randomUUID()}@example.test`],
    );
    actorId = user.rows[0]!.id;
    agencyId = await insertOrganization("AGENCY", "测试代理商");
    clientA = await insertOrganization("CLIENT", "客户甲");
    clientB = await insertOrganization("CLIENT", "客户乙");
    await db.query(
      `INSERT INTO membership(user_id,organization_id,role,status)
       VALUES($1,$2,'AGENCY_OWNER','ACTIVE')`,
      [actorId, agencyId],
    );
    for (const clientId of [clientA, clientB]) {
      await db.query(
        `INSERT INTO agency_client_assignment(agency_organization_id,client_organization_id,status,assigned_by_user_id)
         VALUES($1,$2,'ACTIVE',$3)`,
        [agencyId, clientId, actorId],
      );
    }
    const project = await db.query<{ id: string }>(
      `INSERT INTO project(client_organization_id,name,created_by_user_id)
       VALUES($1,'客户甲项目',$2) RETURNING id`,
      [clientA, actorId],
    );
    projectA = project.rows[0]!.id;
  }, 120_000);

  afterAll(async () => { if (db) await db.close(); });

  it("rejects a project/client mismatch even when the agency is authorized for both clients", async () => {
    const runtime = createAgencyDeliveryRuntime(db);
    const service = new AgencyDeliveryControlService(
      runtime.writes,
      runtime.authorization,
      runtime.projects,
      { next: randomUUID },
      () => "2026-07-19T00:00:00.000Z",
    );
    await expect(service.moveWorkflow({
      agencyOrganizationId: agencyId,
      clientOrganizationId: clientB,
      projectId: projectA,
      stage: "CLIENT_PROFILE",
      toStatus: "IN_PROGRESS",
      reason: "越权范围测试",
      actorUserId: actorId,
    })).rejects.toThrow("PROJECT_CLIENT_SCOPE_MISMATCH");
  });

  it("enforces the same scope in PostgreSQL and accepts the correctly scoped event", async () => {
    await expect(db.query(
      `INSERT INTO agency_workflow_event
       (agency_organization_id,client_organization_id,project_id,stage,from_status,to_status,actor_user_id,reason)
       VALUES($1,$2,$3,'CLIENT_PROFILE','NOT_STARTED','IN_PROGRESS',$4,'数据库越权测试')`,
      [agencyId, clientB, projectA, actorId],
    )).rejects.toThrow(/scope mismatch/i);

    const runtime = createAgencyDeliveryRuntime(db);
    const service = new AgencyDeliveryControlService(
      runtime.writes,
      runtime.authorization,
      runtime.projects,
      { next: randomUUID },
      () => "2026-07-19T00:00:00.000Z",
    );
    const event = await service.moveWorkflow({
      agencyOrganizationId: agencyId,
      clientOrganizationId: clientA,
      projectId: projectA,
      stage: "CLIENT_PROFILE",
      toStatus: "IN_PROGRESS",
      reason: "正确范围测试",
      actorUserId: actorId,
    });
    expect(event.clientOrganizationId).toBe(clientA);
  });

  it("persists manual delivery and reads the same state after a fresh query", async () => {
    const runtime = createAgencyDeliveryRuntime(db);
    const service = new AgencyDeliveryControlService(runtime.writes,runtime.authorization,runtime.projects,{next:randomUUID},()=>new Date().toISOString());
    const common={agencyOrganizationId:agencyId,clientOrganizationId:clientA,projectId:projectA,actorUserId:actorId};
    await service.moveWorkflow({...common,stage:"CHINA_AI_PROBE",toStatus:"IN_PROGRESS",reason:"保留原型历史事件"});
    await service.moveWorkflow({...common,stage:"CHINA_AI_PROBE",toStatus:"BLOCKED",reason:"独立系统原型不具备结构化结果"});
    await service.moveWorkflow({...common,stage:"REPORT",toStatus:"IN_PROGRESS",reason:"开始整理客户报告"});
    await service.moveWorkflow({...common,stage:"REPORT",toStatus:"COMPLETED",reason:"客户报告已人工核对"});
    await service.markReady(common);
    const ready=await buildAgencyPortfolioSummary(agencyId,runtime.reads);
    expect(ready.clients[0]?.delivery.status).toBe("READY");
    expect(ready.abnormalProjects).toBe(0);
    expect(ready.clients[0]?.pendingTasks.some(task=>task.kind==="RUN_PROBE")).toBe(false);
    await service.registerDelivered({...common,receiptReference:"manual-receipt-001"});
    const refreshed=await buildAgencyPortfolioSummary(agencyId,runtime.reads);
    expect(refreshed.clients[0]?.delivery.status).toBe("DELIVERED");
    const receipt=await db.query<{receipt_reference:string}>("SELECT receipt_reference FROM agency_delivery_record WHERE project_id=$1 AND status='DELIVERED'",[projectA]);
    expect(receipt.rows[0]?.receipt_reference).toBe("manual-receipt-001");
  });
});
