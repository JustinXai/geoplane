import type {Queryable} from "../../persistence/database-port.js";
import type {DemandEvidence,KeywordDataset,KeywordRecord,KeywordScope} from "./contracts.js";

/** Read-only compatibility projection. It does not copy or mutate the frozen 0011 tables. */
export async function readLegacyBaiduAsGeneric(db:Queryable,scope:KeywordScope):Promise<{dataset:KeywordDataset|null;records:readonly KeywordRecord[];evidence:readonly DemandEvidence[]}>{
  const imports=await db.query<{id:string;source_file_name:string;started_at:Date}>(`SELECT id,source_file_name,started_at FROM keyword_reference_source_import WHERE client_organization_id=$1 AND project_id=$2 AND source_kind='BAIDU_REFERENCE_EXPORT' ORDER BY started_at,id`,[scope.clientOrganizationId,scope.projectId]);
  if(imports.rows.length===0)return{dataset:null,records:[],evidence:[]};const datasetId=`legacy-baidu:${scope.projectId}`,createdAt=imports.rows[0]!.started_at.toISOString();
  const dataset:KeywordDataset={...scope,id:datasetId,name:"百度关键词（兼容读取）",source:"BAIDU_KEYWORD",status:"ACTIVE",createdByUserId:"legacy-system",createdAt};
  const result=await db.query<{id:string;import_id:string;raw_keyword:string;normalized_keyword:string;observed_at:Date;demand_id:string|null;metric_kind:string|null;metric_value:string|null}>(`SELECT r.id,r.import_id,r.raw_keyword,n.normalized_keyword,r.observed_at,d.id demand_id,d.metric_kind,d.metric_value::text FROM keyword_raw_observation r JOIN keyword_normalized_form n ON n.raw_observation_id=r.id LEFT JOIN keyword_demand_observation d ON d.raw_observation_id=r.id WHERE r.client_organization_id=$1 AND r.project_id=$2 ORDER BY r.observed_at,r.id`,[scope.clientOrganizationId,scope.projectId]);
  const records=result.rows.map((v:any)=>({...scope,id:`legacy:${v.id}`,datasetId,importBatchId:`legacy:${v.import_id}`,keyword:v.raw_keyword,normalizedKeyword:v.normalized_keyword,source:"BAIDU_KEYWORD" as const,createdByUserId:"legacy-system",createdAt:v.observed_at.toISOString()}));
  const evidence=result.rows.filter(v=>v.demand_id&&v.metric_kind&&v.metric_value!==null).map(v=>({...scope,id:`legacy:${v.demand_id}`,keywordRecordId:`legacy:${v.id}`,source:"BAIDU_KEYWORD" as const,metricKind:v.metric_kind!,metricValue:Number(v.metric_value),sourceReference:`legacy-0011:${v.import_id}`,observedAt:v.observed_at.toISOString(),recordedAt:v.observed_at.toISOString()}));
  return{dataset,records,evidence};
}
