import { canAccessClientOrganization } from "../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../contracts/tenancy/entities.js";
import type { AccountAuditWriter } from "./authorization-service.js";
import type { AccountOperationResult, AccountOperationTask } from "./entities.js";
import type { AccountRepository } from "./ports.js";

export class AccountOperationService {
  constructor(private readonly repo:AccountRepository,private readonly audit:AccountAuditWriter){}
  async createTask(ctx:AuthorizationContext,input:{accountId:string;projectId:string;clientOrganizationId:string;operationKind:string;operatorUserId:string}):Promise<AccountOperationTask>{
    const account=await this.repo.findAccountById(input.accountId);const assignment=await this.repo.findActiveAssignment(input.accountId,input.projectId);
    if(!account||!assignment||assignment.clientOrganizationId!==input.clientOrganizationId||!canAccessClientOrganization(ctx,input.clientOrganizationId)){await this.audit.append({action:"account.operation.create",outcome:"DENIED",actorUserId:ctx.actorUserId,actorOrganizationId:ctx.organizationId,clientOrganizationId:input.clientOrganizationId,projectId:input.projectId,targetType:"account_operation_task",targetId:null});throw new Error("Account is not assigned to this authorized project");}
    if(account.status!=="ACTIVE")throw new Error("Account is not active");
    const created=await this.repo.createOperationTask({accountId:account.id,assignmentId:assignment.id,projectId:input.projectId,clientOrganizationId:input.clientOrganizationId,operationKind:input.operationKind.trim(),operationMode:account.operationMode,status:"PENDING",requestedByUserId:ctx.actorUserId,operatorUserId:input.operatorUserId});
    await this.audit.append({action:"account.operation.create",outcome:"ALLOWED",actorUserId:ctx.actorUserId,actorOrganizationId:ctx.organizationId,clientOrganizationId:input.clientOrganizationId,projectId:input.projectId,targetType:"account_operation_task",targetId:created.id,metadata:{operationMode:created.operationMode}});return created;
  }
  async recordResult(ctx:AuthorizationContext,input:{taskId:string;status:"SUCCEEDED"|"FAILED";resultSummary?:string|null;failureCategory?:string|null;publicationReceiptId?:string|null}):Promise<AccountOperationResult>{
    const task=await this.repo.findOperationTaskById(input.taskId);if(!task||!canAccessClientOrganization(ctx,task.clientOrganizationId)){await this.audit.append({action:"account.operation.result",outcome:"DENIED",actorUserId:ctx.actorUserId,actorOrganizationId:ctx.organizationId,clientOrganizationId:task?.clientOrganizationId??null,projectId:task?.projectId??null,targetType:"account_operation_task",targetId:input.taskId});throw new Error("Operation task is not accessible");}
    if(input.status==="FAILED"&&!input.failureCategory?.trim())throw new Error("failureCategory is required for failed operations");
    const at=new Date().toISOString();const result=await this.repo.addOperationResult({taskId:task.id,accountId:task.accountId,status:input.status,resultSummary:input.resultSummary?.trim()||null,failureCategory:input.status==="FAILED"?input.failureCategory!.trim():null,publicationReceiptId:input.publicationReceiptId??null,recordedByUserId:ctx.actorUserId});
    await this.repo.completeOperationTask(task.id,input.status,at);await this.repo.addUsage({accountId:task.accountId,projectId:task.projectId,clientOrganizationId:task.clientOrganizationId,operatorUserId:task.operatorUserId,operationKind:task.operationKind,succeeded:input.status==="SUCCEEDED",failureCategory:result.failureCategory,occurredAt:at});
    await this.audit.append({action:"account.operation.result",outcome:"ALLOWED",actorUserId:ctx.actorUserId,actorOrganizationId:ctx.organizationId,clientOrganizationId:task.clientOrganizationId,projectId:task.projectId,targetType:"account_operation_result",targetId:result.id,metadata:{status:result.status}});return result;
  }
}
