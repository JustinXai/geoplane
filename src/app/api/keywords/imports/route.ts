import { apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { invalid,keywordRequestContext } from "../../../../runtime/keywords/http.js";
import { parseKeywordImport } from "../../../../runtime/keywords/importer.js";
import { prepareKeywordImport } from "../../../../runtime/keywords/normalization.js";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request):Promise<Response>{
  let body:{projectId?:string;fileName?:string;base64?:string};try{body=await request.json();}catch{return invalid("请求正文必须是 JSON。");}
  if(!body.projectId||!body.fileName||!body.base64)return invalid("缺少有效的项目或文件。");
  const context=await keywordRequestContext(request,body.projectId);if("response" in context)return context.response;
  const bytes=Buffer.from(body.base64,"base64");if(bytes.byteLength===0||bytes.byteLength>10*1024*1024)return invalid("关键词文件大小必须在 1 字节到 10 MB 之间。");
  try{
    const parsed=parseKeywordImport(body.fileName,bytes);
    if(parsed.rows.length===0)throw new Error("文件中没有可导入的有效关键词。");
    const scope={clientOrganizationId:context.value.project.clientOrganizationId,projectId:body.projectId};
    const existing=await context.value.repo.findCompletedImportByManifest(scope,parsed.sourceHash);
    if(existing){
      const snapshot=await context.value.runtime.db.query<{id:string}>("SELECT id FROM keyword_reference_snapshot WHERE client_organization_id=$1 AND project_id=$2 AND import_id=$3 LIMIT 1",[scope.clientOrganizationId,scope.projectId,existing.id]);
      return toHttpResponse(apiOk({status:"ALREADY_IMPORTED",importId:existing.id,snapshotId:snapshot.rows[0]?.id??"",parsedCount:existing.parsedCount,rejectedCount:existing.rejectedCount,duplicateRecordCount:0}));
    }
    const latest=await context.value.runtime.db.query<{version:number|string|null}>("SELECT max(snapshot_version) AS version FROM keyword_reference_snapshot WHERE client_organization_id=$1 AND project_id=$2",[scope.clientOrganizationId,scope.projectId]);
    const snapshotVersion=Number(latest.rows[0]?.version??0)+1;
    const prepared=prepareKeywordImport({...scope,sourceFileName:body.fileName,parsed,now:context.value.now(),snapshotVersion},context.value.ids);
    const status=await context.value.repo.savePreparedImport(prepared);
    if(status==="ALREADY_IMPORTED"){
      const saved=await context.value.repo.findCompletedImportByManifest(scope,parsed.sourceHash);
      const snapshot=saved?await context.value.runtime.db.query<{id:string}>("SELECT id FROM keyword_reference_snapshot WHERE client_organization_id=$1 AND project_id=$2 AND import_id=$3 LIMIT 1",[scope.clientOrganizationId,scope.projectId,saved.id]):{rows:[]};
      return toHttpResponse(apiOk({status,importId:saved?.id??"",snapshotId:snapshot.rows[0]?.id??"",parsedCount:saved?.parsedCount??0,rejectedCount:saved?.rejectedCount??0,duplicateRecordCount:prepared.duplicateRecordCount}));
    }
    return toHttpResponse(apiOk({status,importId:prepared.sourceImport.id,snapshotId:prepared.snapshot.id,parsedCount:prepared.sourceImport.parsedCount,rejectedCount:prepared.sourceImport.rejectedCount,duplicateRecordCount:prepared.duplicateRecordCount}));
  }catch(error){return invalid(error instanceof Error?error.message:"关键词文件无法解析。");}
}
