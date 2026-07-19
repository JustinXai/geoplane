import {describe,expect,it} from "vitest";
import type {Queryable,SqlParam} from "../../../src/persistence/database-port.js";
import {readAccountCenter,readManualProbeEntryOptions} from "../../../src/runtime/read-models/domestic-workspaces.js";
import type {GeoPrincipal} from "../../../src/runtime/geo/runtime-context.js";

const agency:GeoPrincipal={userId:"u",role:"AGENCY_OWNER",organizationId:"agency-a",organizationType:"AGENCY",clientOrganizationId:null,assignedClientOrganizationIds:["client-a"]};

describe("domestic workspace read models",()=>{
  it("scopes account reads and never returns credential references",async()=>{let params:readonly SqlParam[]=[];const db={query:async(_sql:string,p?:readonly SqlParam[])=>{params=p??[];return{rows:[{id:"a1",platform_code:"DOUBAO",display_label:"查询账号",account_type:"AI_PLATFORM_ACCOUNT",ownership:"AGENCY_OWNED",secret_reference:"secretref://hidden/value",credential_status:"VERIFIED",status:"ACTIVE",operation_mode:"MANUAL_OPERATION",authorization_status:"AUTHORIZED",assignment_count:"1",health_status:"HEALTHY",risk_status:"NORMAL",pending_task_count:"0",failed_task_count:"0",last_verified_at:null,updated_at:"2026-07-19T00:00:00.000Z"}],rowCount:1}}} as unknown as Queryable;const model=await readAccountCenter(db,agency);expect(params).toEqual(["agency-a","client-a"]);expect(model.accounts[0]).not.toHaveProperty("secretReference");expect(model.accounts[0]?.credentialConfigured).toBe(true)});
  it("returns only server-scoped projects and persisted questions for probe entry",async()=>{const calls:string[]=[];const db={query:async(sql:string)=>{calls.push(sql);if(sql.includes("FROM project p"))return{rows:[{id:"p1",name:"品牌项目",client_name:"客户甲"}],rowCount:1};return{rows:[{keyword:"品牌词",question:"品牌适合哪些人群？"}],rowCount:1}}} as unknown as Queryable;const model=await readManualProbeEntryOptions(db,agency);expect(model.projects).toEqual([{projectId:"p1",projectName:"品牌项目",clientName:"客户甲",questions:[{keyword:"品牌词",question:"品牌适合哪些人群？"}]}]);expect(model.platforms.map(x=>x.displayName)).toEqual(["豆包","通义千问","DeepSeek","腾讯元宝"]);expect(calls[0]).toContain("p.client_organization_id IN")});
});
