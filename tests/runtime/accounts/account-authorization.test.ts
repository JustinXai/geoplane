import { describe, expect, it } from "vitest";
import type { AuthorizationContext } from "../../../src/contracts/tenancy/entities.js";
import { AccountAuthorizationError, AccountAuthorizationService, type AccountAuditEntry } from "../../../src/runtime/accounts/authorization-service.js";
import type { AccountAssignment, AccountAuthorization, AccountOperationResult, AccountOperationTask, AccountHealth, AccountUsageRecord, PlatformAccount } from "../../../src/runtime/accounts/entities.js";
import type { AccountRepository } from "../../../src/runtime/accounts/ports.js";

class FakeRepo implements AccountRepository {
  accounts: PlatformAccount[] = []; authorizations: AccountAuthorization[] = []; assignments: AccountAssignment[] = [];
  async createAccount(i: Omit<PlatformAccount,"id"|"createdAt"|"updatedAt">) { const a={...i,id:`a${this.accounts.length+1}`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; this.accounts.push(a); return a; }
  async findAccountById(id:string){return this.accounts.find(x=>x.id===id)??null;}
  async addAuthorization(i:Omit<AccountAuthorization,"id"|"createdAt">){const a={...i,id:`z${this.authorizations.length+1}`,createdAt:new Date().toISOString()};this.authorizations.push(a);return a;}
  async findActiveAuthorization(id:string){return this.authorizations.find(x=>x.accountId===id&&x.status==="AUTHORIZED")??null;}
  async revokeAuthorization(_id:string,_userId:string,_at:string):Promise<AccountAuthorization>{throw new Error("unused");}
  async addAssignment(i:Omit<AccountAssignment,"id"|"assignedAt"|"revokedAt">){const a={...i,id:`s${this.assignments.length+1}`,assignedAt:new Date().toISOString(),revokedAt:null};this.assignments.push(a);return a;}
  async findActiveAssignment(a:string,p:string){return this.assignments.find(x=>x.accountId===a&&x.projectId===p&&x.status==="ACTIVE")??null;}
  async addHealth(_i:Omit<AccountHealth,"id">):Promise<AccountHealth>{throw new Error("unused");}
  async addUsage(_i:Omit<AccountUsageRecord,"id">):Promise<AccountUsageRecord>{throw new Error("unused");}
  async createOperationTask(_i:Omit<AccountOperationTask,"id"|"requestedAt"|"startedAt"|"completedAt">):Promise<AccountOperationTask>{throw new Error("unused");}
  async completeOperationTask():Promise<AccountOperationTask>{throw new Error("unused");}
  async findOperationTaskById():Promise<AccountOperationTask|null>{return null;}
  async addOperationResult(_i:Omit<AccountOperationResult,"id"|"recordedAt">):Promise<AccountOperationResult>{throw new Error("unused");}
}
const ctx=(role:AuthorizationContext["actorRole"],org:string,allowed:string[]=[]):AuthorizationContext=>({actorUserId:`u-${org}`,actorRole:role,organizationId:org,organizationType:role==="PLATFORM_SUPER_ADMIN"?"PLATFORM":role==="CLIENT_OWNER"?"CLIENT":"AGENCY",activeProjectId:null,activeClientOrganizationId:role==="CLIENT_OWNER"?org:null,assignedClientOrganizationIds:allowed,allowedClientOrganizationIds:allowed,isPlatformAdmin:role==="PLATFORM_SUPER_ADMIN",permissions:[]});

describe("account ownership authorization",()=>{
  it("prevents a client account from crossing clients and audits the denial",async()=>{
    const repo=new FakeRepo(); const events:AccountAuditEntry[]=[]; const svc=new AccountAuthorizationService(repo,{append:async e=>{events.push(e);}});
    const owner=ctx("CLIENT_OWNER","client-a"); const account=await svc.register(owner,{platformCode:"QWEN",accountType:"AI_PLATFORM_ACCOUNT",ownership:"CLIENT_OWNED",clientOrganizationId:"client-a",displayLabel:"客户账号"});
    await svc.authorize(owner,{accountId:account.id});
    await expect(svc.assign(ctx("PLATFORM_SUPER_ADMIN","platform"),{accountId:account.id,projectId:"project-b",clientOrganizationId:"client-b",operatorUserId:"operator"})).rejects.toBeInstanceOf(AccountAuthorizationError);
    expect(repo.assignments).toHaveLength(0); expect(events.at(-1)?.outcome).toBe("DENIED");
  });

  it("requires explicit agency client access and an authorization before assignment",async()=>{
    const repo=new FakeRepo(); const events:AccountAuditEntry[]=[]; const svc=new AccountAuthorizationService(repo,{append:async e=>{events.push(e);}});
    const agency=ctx("AGENCY_OWNER","agency-a",["client-a"]); const account=await svc.register(agency,{platformCode:"BAIJIAHAO",accountType:"CONTENT_PLATFORM_ACCOUNT",ownership:"AGENCY_OWNED",agencyOrganizationId:"agency-a",displayLabel:"代理商内容账号"});
    await expect(svc.assign(agency,{accountId:account.id,projectId:"p1",clientOrganizationId:"client-a",operatorUserId:"operator"})).rejects.toThrow(/authorized/);
    await svc.authorize(agency,{accountId:account.id});
    const assignment=await svc.assign(agency,{accountId:account.id,projectId:"p1",clientOrganizationId:"client-a",operatorUserId:"operator"});
    expect(assignment.clientOrganizationId).toBe("client-a"); expect(events.filter(e=>e.outcome==="ALLOWED")).toHaveLength(3);
  });
});
