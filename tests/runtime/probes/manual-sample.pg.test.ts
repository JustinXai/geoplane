import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { ManualProbeService, PgRawProbeResultRepository } from "../../../src/runtime/probes/manual-sample.js";

const config = loadDatabaseConfig({ test: true });
let db: DatabasePort;
let actorId = "";
let clientA = "";
let clientB = "";
let projectA = "";
let projectB = "";

async function createClientProject(label:string):Promise<{clientId:string;projectId:string}>{
  const organization=await db.query<{id:string}>(`INSERT INTO organization(type,display_name,idempotency_key,created_by_user_id)
    VALUES('CLIENT',$1,$2,$3) RETURNING id`,[label,randomUUID(),actorId]);
  const clientId=organization.rows[0]!.id;
  const project=await db.query<{id:string}>(`INSERT INTO project(client_organization_id,name,created_by_user_id)
    VALUES($1,$2,$3) RETURNING id`,[clientId,`${label}项目`,actorId]);
  return{clientId,projectId:project.rows[0]!.id};
}

describe.skipIf(config===null)("国内 AI 检测 PostgreSQL 持久化",()=>{
  beforeAll(async()=>{
    db=createPgDatabase({connectionString:config!.connectionString,max:2});
    await db.query("DROP SCHEMA public CASCADE");
    await db.query("CREATE SCHEMA public");
    await applyMigrations(db,"migrations");
    const actor=await db.query<{id:string}>(`INSERT INTO "user"(email) VALUES($1) RETURNING id`,[`probe-${randomUUID()}@example.test`]);
    actorId=actor.rows[0]!.id;
    ({clientId:clientA,projectId:projectA}=await createClientProject("客户甲"));
    ({clientId:clientB,projectId:projectB}=await createClientProject("客户乙"));
  },120_000);

  afterAll(async()=>{if(db)await db.close()});

  it("保存后可按项目重新读取，且不会混入其他客户记录",async()=>{
    const repository=new PgRawProbeResultRepository(db);
    const service=new ManualProbeService(repository,()=>new Date("2026-07-19T12:00:00Z"),randomUUID);
    const saved=await service.record({clientOrganizationId:clientA,projectId:projectA,platform:"DOUBAO",collectionMode:"MANUAL_SAMPLE",question:"品牌适合哪些人群？",outcome:"ANSWERED",answerText:"适合重视合规信息的人群。",screenshotReference:"evidence://probe/one",observedAt:"2026-07-19T11:00:00Z"},actorId);
    await service.record({clientOrganizationId:clientB,projectId:projectB,platform:"QWEN",collectionMode:"MANUAL_SAMPLE",question:"另一个问题",outcome:"FAILED",failureCode:"ANSWER_NOT_RETURNED",observedAt:"2026-07-19T11:05:00Z"},actorId);
    const rows=await repository.listByProject(clientA,projectA);
    expect(rows).toEqual([saved]);
    expect(rows[0]).toMatchObject({answerText:"适合重视合规信息的人群。",screenshotReference:"evidence://probe/one",recordedByUserId:actorId});
  });

  it("数据库拒绝修改或删除已登记样本",async()=>{
    const row=await db.query<{id:string}>("SELECT id FROM raw_probe_result WHERE project_id=$1 LIMIT 1",[projectA]);
    await expect(db.query("UPDATE raw_probe_result SET answer_text='改写' WHERE id=$1",[row.rows[0]!.id])).rejects.toThrow(/append-only/i);
    await expect(db.query("DELETE FROM raw_probe_result WHERE id=$1",[row.rows[0]!.id])).rejects.toThrow(/append-only/i);
  });
});
