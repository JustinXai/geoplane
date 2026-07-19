import { apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { invalid,keywordRequestContext } from "../../../../runtime/keywords/http.js";
import { parseKeywordImport } from "../../../../runtime/keywords/importer.js";
import { prepareKeywordImport } from "../../../../runtime/keywords/normalization.js";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request):Promise<Response>{
  let body:{projectId?:string;fileName?:string;base64?:string;snapshotVersion?:number};try{body=await request.json();}catch{return invalid("请求正文必须是 JSON。");}
  if(!body.projectId||!body.fileName||!body.base64||!Number.isInteger(body.snapshotVersion)||(body.snapshotVersion ?? 0)<1)return invalid("缺少有效的项目、文件或快照版本。");
  const context=await keywordRequestContext(request,body.projectId);if("response" in context)return context.response;
  const bytes=Buffer.from(body.base64,"base64");if(bytes.byteLength===0||bytes.byteLength>10*1024*1024)return invalid("关键词文件大小必须在 1 字节到 10 MB 之间。");
  try{const parsed=parseKeywordImport(body.fileName,bytes);const prepared=prepareKeywordImport({clientOrganizationId:context.value.project.clientOrganizationId,projectId:body.projectId,sourceFileName:body.fileName,parsed,now:context.value.now(),snapshotVersion:body.snapshotVersion!},context.value.ids);const status=await context.value.repo.savePreparedImport(prepared);return toHttpResponse(apiOk({status,importId:prepared.sourceImport.id,snapshotId:prepared.snapshot.id,parsedCount:prepared.sourceImport.parsedCount,rejectedCount:prepared.sourceImport.rejectedCount,duplicateRecordCount:prepared.duplicateRecordCount}));}catch(error){return invalid(error instanceof Error?error.message:"关键词文件无法解析。");}
}
