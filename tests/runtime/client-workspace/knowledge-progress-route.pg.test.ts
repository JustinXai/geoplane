import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { __setAuthRuntimeForTests,createAuthRuntime,type AuthRuntime } from "../../../src/runtime/auth/runtime-context.js";
import { __setGeoRuntimeForTests,createGeoRuntime } from "../../../src/runtime/geo/runtime-context.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { GET as progressRoute } from "../../../src/app/api/projects/[projectId]/knowledge-progress/route.js";
import { TEST_LOGIN_PASSWORD,TEST_LOGIN_PASSWORD_HASH } from "../../helpers/auth-credentials.js";

const config=loadDatabaseConfig({test:true});
const migrationsDir=join(dirname(fileURLToPath(import.meta.url)),"..","..","..","migrations");
let db:DatabasePort;let auth:AuthRuntime;

async function clientIdentity(email:string,key:string){
  const user=await db.query<{id:string}>(`INSERT INTO "user"(email,password_hash) VALUES($1,$2) RETURNING id`,[email,TEST_LOGIN_PASSWORD_HASH]);
  const userId=user.rows[0]!.id;
  const organization=await auth.repos.organizations.createIdempotent({type:"CLIENT",displayName:key,idempotencyKey:key,createdByUserId:userId});
  await auth.repos.memberships.create({userId,organizationId:organization.id,role:"CLIENT_OWNER"});
  return {userId,organizationId:organization.id,email};
}
async function login(email:string){const response=await loginRoute(new Request("http://test/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password:TEST_LOGIN_PASSWORD})}));return response.headers.get("set-cookie")!.split(";")[0]!;}

describe.skipIf(config===null)("客户企业资料进度真实路由",()=>{
  beforeAll(async()=>{db=createPgDatabase({connectionString:config!.connectionString,max:4});await applyMigrations(db,migrationsDir);auth=createAuthRuntime(db);__setAuthRuntimeForTests(auth);__setGeoRuntimeForTests(createGeoRuntime(db));});
  afterAll(async()=>{__setAuthRuntimeForTests(null);__setGeoRuntimeForTests(null);if(db)await db.close();});
  beforeEach(async()=>{await db.query(`TRUNCATE knowledge_issue,knowledge_document,knowledge_package,session,membership,project,organization,"user" RESTART IDENTITY CASCADE`);});

  it("返回本客户项目事实并拒绝另一客户",async()=>{
    const owner=await clientIdentity("overview-owner@example.test","overview-owner");
    const outsider=await clientIdentity("overview-outsider@example.test","overview-outsider");
    const project=await auth.repos.projects.create({clientOrganizationId:owner.organizationId,name:"客户项目",createdByUserId:owner.userId});
    const pkg=await db.query<{id:string}>(`INSERT INTO knowledge_package(client_organization_id,project_id,title,created_by_user_id) VALUES($1,$2,'企业资料',$3) RETURNING id`,[owner.organizationId,project.id,owner.userId]);
    await db.query(`INSERT INTO knowledge_issue(client_organization_id,project_id,package_id,kind,severity,message,created_by_user_id) VALUES($1,$2,$3,'MISSING_INFORMATION','BLOCKER','缺少服务范围',$4)`,[owner.organizationId,project.id,pkg.rows[0]!.id,owner.userId]);
    const [ownerCookie,outsiderCookie]=await Promise.all([login(owner.email),login(outsider.email)]);
    const allowed=(await progressRoute(new Request("http://test/progress",{headers:{cookie:ownerCookie}}),{params:Promise.resolve({projectId:project.id})}))!;
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data).toMatchObject({packageCount:1,missingInformationCount:1,status:"NEEDS_INFORMATION"});
    const denied=(await progressRoute(new Request("http://test/progress",{headers:{cookie:outsiderCookie}}),{params:Promise.resolve({projectId:project.id})}))!;
    expect(denied.status).toBe(403);
  });
});
