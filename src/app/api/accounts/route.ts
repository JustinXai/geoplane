/** Minimal authenticated command API for DOMESTIC_ACCOUNT_CENTER_V1. */
import { apiErr, apiOk } from "../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../runtime/auth/runtime-context.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import { AccountAuthorizationError, AccountAuthorizationService } from "../../../runtime/accounts/authorization-service.js";
import { AccountOperationService } from "../../../runtime/accounts/operation-service.js";
import { PgAccountAuditWriter, PgAccountRepository } from "../../../runtime/accounts/pg-repository.js";

export const runtime="nodejs";export const dynamic="force-dynamic";
const forbidden=new Set(["password","cookie","token","apiKey","api_key"]);
const text=(b:Record<string,unknown>,k:string)=>typeof b[k]==="string"&&b[k]!.trim()?String(b[k]).trim():null;

export async function POST(request:Request):Promise<Response>{
  const rt=getAuthRuntime();const session=await rt.resolveSession(request.headers.get("cookie"));
  if(!session)return toHttpResponse(apiErr("UNAUTHENTICATED","Authentication is required."));
  const body=await readJsonBody(request);
  if(Object.keys(body).some(k=>forbidden.has(k)))return toHttpResponse(apiErr("VALIDATION_FAILED","Plaintext credentials are forbidden; provide secretReference only."));
  const action=text(body,"action");if(!action)return toHttpResponse(apiErr("VALIDATION_FAILED","action is required."));
  const ctx:AuthorizationContext={actorUserId:session.userId,actorRole:session.role,organizationId:session.organizationId,organizationType:session.organizationType,activeProjectId:null,activeClientOrganizationId:session.activeClientOrganizationId,assignedClientOrganizationIds:[...session.assignedClientOrganizationIds],allowedClientOrganizationIds:[...session.assignedClientOrganizationIds],isPlatformAdmin:session.role==="PLATFORM_SUPER_ADMIN",permissions:[]};
  try{
    const data=await rt.db.transaction(async tx=>{const repo=new PgAccountRepository(tx);const audit=new PgAccountAuditWriter(tx);const auth=new AccountAuthorizationService(repo,audit);const ops=new AccountOperationService(repo,audit);
      switch(action){
        case "REGISTER":{const platformCode=text(body,"platformCode"),displayLabel=text(body,"displayLabel"),accountType=text(body,"accountType"),ownership=text(body,"ownership");if(!platformCode||!displayLabel||(accountType!=="AI_PLATFORM_ACCOUNT"&&accountType!=="CONTENT_PLATFORM_ACCOUNT")||(ownership!=="PLATFORM_OWNED"&&ownership!=="CLIENT_OWNED"&&ownership!=="AGENCY_OWNED"))throw new Error("Invalid account registration fields");const a=await auth.register(ctx,{platformCode,displayLabel,accountType,ownership,agencyOrganizationId:text(body,"agencyOrganizationId"),clientOrganizationId:text(body,"clientOrganizationId"),secretReference:text(body,"secretReference")});const{secretReference:_secret,...safe}=a;return safe;}
        case "AUTHORIZE":{const accountId=text(body,"accountId");if(!accountId)throw new Error("accountId is required");return auth.authorize(ctx,{accountId,clientOrganizationId:text(body,"clientOrganizationId"),agencyOrganizationId:text(body,"agencyOrganizationId")});}
        case "ASSIGN":{const accountId=text(body,"accountId"),projectId=text(body,"projectId"),clientOrganizationId=text(body,"clientOrganizationId"),operatorUserId=text(body,"operatorUserId");if(!accountId||!projectId||!clientOrganizationId||!operatorUserId)throw new Error("Assignment fields are required");return auth.assign(ctx,{accountId,projectId,clientOrganizationId,operatorUserId});}
        case "CREATE_OPERATION":{const accountId=text(body,"accountId"),projectId=text(body,"projectId"),clientOrganizationId=text(body,"clientOrganizationId"),operatorUserId=text(body,"operatorUserId"),operationKind=text(body,"operationKind");if(!accountId||!projectId||!clientOrganizationId||!operatorUserId||!operationKind)throw new Error("Operation fields are required");return ops.createTask(ctx,{accountId,projectId,clientOrganizationId,operatorUserId,operationKind});}
        case "RECORD_RESULT":{const taskId=text(body,"taskId"),status=text(body,"status");if(!taskId||(status!=="SUCCEEDED"&&status!=="FAILED"))throw new Error("Valid taskId and status are required");return ops.recordResult(ctx,{taskId,status,resultSummary:text(body,"resultSummary"),failureCategory:text(body,"failureCategory"),publicationReceiptId:text(body,"publicationReceiptId")});}
        default:throw new Error("Unsupported account action");
      }});
    return toHttpResponse(apiOk(data));
  }catch(error){if(error instanceof AccountAuthorizationError)return toHttpResponse(apiErr("FORBIDDEN","Account operation is not authorized."));return toHttpResponse(apiErr("VALIDATION_FAILED",error instanceof Error?error.message:"Account operation failed."));}
}
