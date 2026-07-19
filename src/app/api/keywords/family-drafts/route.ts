import { apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { invalid,keywordRequestContext } from "../../../../runtime/keywords/http.js";
import { KeywordReviewService } from "../../../../runtime/keywords/review-service.js";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request):Promise<Response>{
  let body:{projectId?:string;snapshotId?:string;normalizedFormIds?:string[];label?:string;rationale?:string;version?:number};
  try{body=await request.json();}catch{return invalid("请求正文必须是 JSON。");}
  if(!body.projectId||!body.snapshotId||!Array.isArray(body.normalizedFormIds)||!body.label||!body.rationale||!Number.isInteger(body.version)||body.version!<1)return invalid("关键词组参数不完整。");
  const context=await keywordRequestContext(request,body.projectId);if("response" in context)return context.response;
  try{const value=await new KeywordReviewService(context.value.repo,context.value.ids,context.value.now).createSubmittedFamily({clientOrganizationId:context.value.project.clientOrganizationId,projectId:body.projectId,snapshotId:body.snapshotId,normalizedFormIds:body.normalizedFormIds,label:body.label,rationale:body.rationale,createdByUserId:context.value.principal.userId,version:body.version!});return toHttpResponse(apiOk(value));}
  catch(error){return invalid(error instanceof Error?error.message:"关键词组创建失败。");}
}
