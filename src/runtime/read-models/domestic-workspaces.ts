/** Read-only projections for the domestic GEO workspaces. No domain state is changed here. */
import type { Queryable, SqlParam } from "../../persistence/database-port.js";
import type { GeoPrincipal } from "../geo/runtime-context.js";
import type { AccountHealthStatus, AccountOperationMode, AccountOwnership, AccountRiskStatus, AccountStatus, AccountType, CredentialStatus } from "../accounts/entities.js";
import type { KeywordExpansionBatch } from "../keyword-expansion/contract.js";
import { createDomesticP0PolicyPackRegistry } from "../policy-packs/medical-aesthetics-v1.js";
import type { VerticalPolicyPackDefinition } from "../policy-packs/entities.js";
import { PgRawProbeResultRepository, type RawProbeResult } from "../probes/manual-sample.js";
import { safeBusinessDisplayName } from "../ui-adapters/formatters.js";

const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString();

export interface AccountCenterItem {
  readonly id: string;
  readonly platformCode: string;
  readonly displayLabel: string;
  readonly accountType: AccountType;
  readonly ownership: AccountOwnership;
  readonly credentialConfigured: boolean;
  readonly credentialStatus: CredentialStatus;
  readonly status: AccountStatus;
  readonly operationMode: AccountOperationMode;
  readonly authorizationStatus: "PENDING" | "AUTHORIZED" | "REVOKED" | null;
  readonly assignmentCount: number;
  readonly authorizedProjects: readonly { readonly id: string; readonly name: string }[];
  readonly healthStatus: AccountHealthStatus;
  readonly riskStatus: AccountRiskStatus;
  readonly lastException: string | null;
  readonly lastCheckedAt: string | null;
  readonly pendingTaskCount: number;
  readonly failedTaskCount: number;
  readonly lastVerifiedAt: string | null;
  readonly updatedAt: string;
}
export interface AccountCenterReadModel {
  readonly accounts: readonly AccountCenterItem[];
  readonly totals: { readonly all: number; readonly platformOwned: number; readonly agencyOwned: number; readonly clientOwned: number; readonly needsAttention: number; readonly pendingTasks: number; readonly failedTasks: number };
}

interface AccountRow {
  id: string; platform_code: string; display_label: string; account_type: AccountType; ownership: AccountOwnership;
  credential_status: CredentialStatus; status: AccountStatus; operation_mode: AccountOperationMode;
  authorization_status: AccountCenterItem["authorizationStatus"]; assignment_count: string | number;
  authorized_projects: unknown; health_status: AccountHealthStatus | null; risk_status: AccountRiskStatus | null;
  last_exception: string | null; checked_at: Date | string | null;
  pending_task_count: string | number; failed_task_count: string | number; last_verified_at: Date | string | null; updated_at: Date | string;
}

function accountWhere(principal: GeoPrincipal): { sql: string; params: readonly SqlParam[] } {
  if (principal.role === "PLATFORM_SUPER_ADMIN") return { sql: "TRUE", params: [] };
  if (principal.organizationType === "CLIENT" && principal.clientOrganizationId) {
    return { sql: "a.ownership='CLIENT_OWNED' AND a.client_organization_id=$1", params: [principal.clientOrganizationId] };
  }
  if (principal.organizationType === "AGENCY") {
    const assigned = [...principal.assignedClientOrganizationIds];
    const clientClause = assigned.length === 0 ? "FALSE" : `a.client_organization_id IN (${assigned.map((_,index)=>`$${index+2}`).join(",")})`;
    return {
      sql: `((a.ownership='AGENCY_OWNED' AND a.agency_organization_id=$1) OR (a.ownership='CLIENT_OWNED' AND ${clientClause}))`,
      params: [principal.organizationId, ...assigned],
    };
  }
  return { sql: "FALSE", params: [] };
}

export async function readAccountCenter(db: Queryable, principal: GeoPrincipal): Promise<AccountCenterReadModel> {
  const scope = accountWhere(principal);
  const result = await db.query<AccountRow>(`SELECT a.id,a.platform_code,a.display_label,a.account_type,a.ownership,
    a.credential_status,a.status,a.operation_mode,a.last_verified_at,a.updated_at,
    au.status AS authorization_status,
    (SELECT count(*) FROM account_assignment aa WHERE aa.account_id=a.id AND aa.status='ACTIVE') AS assignment_count,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name,p.id)
      FROM account_assignment aa JOIN project p ON p.id=aa.project_id
      WHERE aa.account_id=a.id AND aa.status='ACTIVE'),'[]'::jsonb) AS authorized_projects,
    h.health_status,h.risk_status,h.last_exception,h.checked_at,
    (SELECT count(*) FROM account_operation_task t WHERE t.account_id=a.id AND t.status IN ('PENDING','IN_PROGRESS')) AS pending_task_count,
    (SELECT count(*) FROM account_operation_task t WHERE t.account_id=a.id AND t.status='FAILED') AS failed_task_count
    FROM platform_account a
    LEFT JOIN LATERAL (SELECT status FROM account_authorization WHERE account_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1) au ON TRUE
    LEFT JOIN LATERAL (SELECT health_status,risk_status,last_exception,checked_at FROM account_health WHERE account_id=a.id ORDER BY checked_at DESC,id DESC LIMIT 1) h ON TRUE
    WHERE ${scope.sql} ORDER BY a.updated_at DESC,a.id`, scope.params);
  const accounts = result.rows.map((r): AccountCenterItem => ({
    id:r.id, platformCode:r.platform_code, displayLabel:r.display_label, accountType:r.account_type, ownership:r.ownership,
    credentialConfigured:r.credential_status !== "NOT_CONFIGURED", credentialStatus:r.credential_status, status:r.status, operationMode:r.operation_mode,
    authorizationStatus:r.authorization_status, assignmentCount:Number(r.assignment_count),
    authorizedProjects:Array.isArray(r.authorized_projects)?r.authorized_projects.filter((p):p is {id:string;name:string}=>!!p&&typeof p==="object"&&typeof (p as any).id==="string"&&typeof (p as any).name==="string").map(p=>({id:p.id,name:p.name})):[],
    healthStatus:r.health_status ?? "UNKNOWN", riskStatus:r.risk_status ?? "UNKNOWN", lastException:r.last_exception??null,lastCheckedAt:r.checked_at?iso(r.checked_at):null, pendingTaskCount:Number(r.pending_task_count), failedTaskCount:Number(r.failed_task_count),
    lastVerifiedAt:iso(r.last_verified_at), updatedAt:iso(r.updated_at)!,
  }));
  return { accounts, totals: { all:accounts.length, platformOwned:accounts.filter(x=>x.ownership==="PLATFORM_OWNED").length,
    agencyOwned:accounts.filter(x=>x.ownership==="AGENCY_OWNED").length, clientOwned:accounts.filter(x=>x.ownership==="CLIENT_OWNED").length,
    needsAttention:accounts.filter(x=>x.riskStatus==="ATTENTION"||x.riskStatus==="BLOCKED"||x.credentialStatus==="EXPIRED"||x.credentialStatus==="REVOKED").length,
    pendingTasks:accounts.reduce((n,x)=>n+x.pendingTaskCount,0), failedTasks:accounts.reduce((n,x)=>n+x.failedTaskCount,0) } };
}

export interface BaiduKeywordImportView { readonly id:string; readonly fileName:string; readonly format:"CSV"|"XLSX"; readonly status:"PENDING"|"VALIDATED"|"COMPLETED"|"FAILED"; readonly parsedCount:number; readonly rejectedCount:number; readonly snapshotVersion:number|null; readonly demandObservationCount:number; readonly sealedAt:string|null }
export interface BaiduKeywordItemView { readonly id:string; readonly importId:string; readonly rawKeyword:string; readonly normalizedKeyword:string; readonly seedKeyword:string; readonly demandValue:number|null; readonly demandEvidence:"OBSERVED_DEMAND"|null; readonly observedAt:string }
export interface BaiduKeywordReadModel {
  readonly imports:readonly BaiduKeywordImportView[];
  readonly keywords:readonly BaiduKeywordItemView[];
  readonly totals:{readonly imports:number;readonly keywords:number;readonly withObservedDemand:number;readonly rejectedRows:number};
  readonly capabilityGaps:readonly string[];
}

export async function readBaiduKeywordOverview(db: Queryable, clientOrganizationId:string, projectId:string):Promise<BaiduKeywordReadModel>{
  const imports=await db.query<any>(`SELECT i.id,i.source_file_name,i.source_format,i.status,i.parsed_count,i.rejected_count,
    s.snapshot_version,s.demand_observation_count,s.sealed_at
    FROM keyword_reference_source_import i LEFT JOIN keyword_reference_snapshot s ON s.import_id=i.id
    WHERE i.client_organization_id=$1 AND i.project_id=$2 ORDER BY i.started_at DESC,i.id`,[clientOrganizationId,projectId]);
  const keywords=await db.query<any>(`SELECT r.id,r.import_id,r.raw_keyword,r.seed_keyword,r.observed_at,n.normalized_keyword,d.metric_value,d.evidence_status
    FROM keyword_raw_observation r JOIN keyword_normalized_form n ON n.raw_observation_id=r.id
    LEFT JOIN keyword_demand_observation d ON d.raw_observation_id=r.id AND d.normalized_form_id=n.id
    WHERE r.client_organization_id=$1 AND r.project_id=$2 ORDER BY r.observed_at DESC,r.id`,[clientOrganizationId,projectId]);
  const importViews=imports.rows.map((r:any):BaiduKeywordImportView=>({id:r.id,fileName:r.source_file_name,format:r.source_format,status:r.status,
      parsedCount:Number(r.parsed_count),rejectedCount:Number(r.rejected_count),snapshotVersion:r.snapshot_version===null?null:Number(r.snapshot_version),
      demandObservationCount:Number(r.demand_observation_count??0),sealedAt:iso(r.sealed_at)}));
  const keywordViews=keywords.rows.map((r:any):BaiduKeywordItemView=>({id:r.id,importId:r.import_id,rawKeyword:r.raw_keyword,
      normalizedKeyword:r.normalized_keyword,seedKeyword:r.seed_keyword,demandValue:r.metric_value===null?null:Number(r.metric_value),
      demandEvidence:r.evidence_status??null,observedAt:iso(r.observed_at)!}));
  return {imports:importViews,keywords:keywordViews,totals:{imports:importViews.length,keywords:keywordViews.length,
      withObservedDemand:keywordViews.filter((item)=>item.demandEvidence==="OBSERVED_DEMAND").length,
      rejectedRows:importViews.reduce((sum,item)=>sum+item.rejectedCount,0)},
    capabilityGaps:["历史导入批次未保存重复行数量","百度推荐出价尚未接入","百度竞争度尚未接入","地域维度尚未接入"]};
}

export async function readKeywordExpansionBatches(db:Queryable,clientOrganizationId:string,projectId:string):Promise<readonly KeywordExpansionBatch[]>{
  const batches=await db.query<any>(`SELECT * FROM keyword_expansion_batch WHERE client_organization_id=$1 AND project_id=$2 ORDER BY created_at DESC,id`,[clientOrganizationId,projectId]);
  const out:KeywordExpansionBatch[]=[];
  for(const b of batches.rows){const candidates=await db.query<any>(`SELECT c.*,e.status AS review_status FROM keyword_expansion_candidate c LEFT JOIN keyword_expansion_review_event e ON e.candidate_id=c.id WHERE c.batch_id=$1 ORDER BY c.id`,[b.id]);
    out.push({id:b.id,clientOrganizationId:b.client_organization_id,projectId:b.project_id,version:Number(b.version),status:"PREVIEW",createdAt:iso(b.created_at)!,candidates:candidates.rows.map((c:any)=>({id:c.id,batchId:c.batch_id,keyword:c.keyword,question:c.question,reason:c.reason,confidence:Number(c.confidence),status:c.review_status??"NEEDS_HUMAN_REVIEW",provenance:{generator:"DETERMINISTIC_OFFLINE",generatorVersion:b.generator_version,generatedAt:iso(b.created_at)!,requestedByUserId:b.requested_by_user_id,inputSnapshot:b.input_snapshot}}))});}
  return out;
}

export async function readManualProbeSamples(db:Queryable,clientOrganizationId:string,projectId:string):Promise<readonly RawProbeResult[]>{return new PgRawProbeResultRepository(db as any).listByProject(clientOrganizationId,projectId)}

export type ClientKnowledgeProgressStatus = "NOT_STARTED"|"NEEDS_INFORMATION"|"READY_FOR_CONFIRMATION"|"CONFIRMED";
export interface ClientKnowledgeProgressReadModel {
  readonly packageCount:number;
  readonly confirmedPackageCount:number;
  readonly documentCount:number;
  readonly openIssueCount:number;
  readonly missingInformationCount:number;
  readonly status:ClientKnowledgeProgressStatus;
  readonly updatedAt:string|null;
}

/** A project-scoped, client-safe readiness proxy. It deliberately reports facts, not a made-up percentage. */
export async function readClientKnowledgeProgress(
  db:Queryable,clientOrganizationId:string,projectId:string,
):Promise<ClientKnowledgeProgressReadModel>{
  const result=await db.query<any>(`SELECT
    (SELECT count(*)::int FROM knowledge_package WHERE client_organization_id=$1 AND project_id=$2) package_count,
    (SELECT count(*)::int FROM knowledge_package WHERE client_organization_id=$1 AND project_id=$2 AND status='CONFIRMED') confirmed_package_count,
    (SELECT count(*)::int FROM knowledge_document WHERE client_organization_id=$1 AND project_id=$2) document_count,
    (SELECT count(*)::int FROM knowledge_issue WHERE client_organization_id=$1 AND project_id=$2 AND resolved=false) open_issue_count,
    (SELECT count(*)::int FROM knowledge_issue WHERE client_organization_id=$1 AND project_id=$2 AND resolved=false AND kind='MISSING_INFORMATION') missing_information_count,
    (SELECT max(updated_at) FROM knowledge_package WHERE client_organization_id=$1 AND project_id=$2) updated_at`,
    [clientOrganizationId,projectId]);
  const row=result.rows[0]??{};
  const packageCount=Number(row.package_count??0),confirmedPackageCount=Number(row.confirmed_package_count??0);
  const openIssueCount=Number(row.open_issue_count??0),missingInformationCount=Number(row.missing_information_count??0);
  const status:ClientKnowledgeProgressStatus=packageCount===0?"NOT_STARTED":
    openIssueCount>0?"NEEDS_INFORMATION":confirmedPackageCount===packageCount?"CONFIRMED":"READY_FOR_CONFIRMATION";
  return {packageCount,confirmedPackageCount,documentCount:Number(row.document_count??0),openIssueCount,
    missingInformationCount,status,updatedAt:iso(row.updated_at??null)};
}

export interface ManualProbeQuestionOption { readonly keyword:string; readonly question:string }
export interface ManualProbeProjectOption { readonly projectId:string; readonly projectName:string; readonly clientName:string; readonly questions:readonly ManualProbeQuestionOption[] }
export interface ManualProbeEntryOptions { readonly projects:readonly ManualProbeProjectOption[]; readonly platforms:readonly {readonly code:string;readonly displayName:string}[] }

const CONFIRMED_PROBE_QUESTIONS_SQL = `SELECT DISTINCT k.keyword,q.question
  FROM opportunity o
  JOIN LATERAL (
    SELECT h.decision FROM human_review_decision h
    WHERE h.opportunity_id=o.id
    ORDER BY h.decided_at DESC,h.created_at DESC,h.id DESC LIMIT 1
  ) latest_review ON latest_review.decision='APPROVED'
  JOIN keyword_question_map_keyword k
    ON k.keyword_question_map_id=o.keyword_question_map_id AND k.keyword=o.keyword
  JOIN keyword_question_map_question q ON q.keyword_id=k.id
  WHERE o.client_organization_id=$1 AND o.project_id=$2
  ORDER BY k.keyword,q.question`;

export async function readConfirmedManualProbeQuestions(
  db:Queryable,clientOrganizationId:string,projectId:string,
):Promise<readonly ManualProbeQuestionOption[]>{
  const result=await db.query<any>(CONFIRMED_PROBE_QUESTIONS_SQL,[clientOrganizationId,projectId]);
  return result.rows.map((row:any)=>({keyword:row.keyword,question:row.question}));
}

export async function isConfirmedManualProbeQuestion(
  db:Queryable,clientOrganizationId:string,projectId:string,question:string,
):Promise<boolean>{
  const questions=await readConfirmedManualProbeQuestions(db,clientOrganizationId,projectId);
  return questions.some(item=>item.question===question.trim());
}

export async function readManualProbeEntryOptions(db:Queryable,principal:GeoPrincipal):Promise<ManualProbeEntryOptions>{
  let where="TRUE";const params:SqlParam[]=[];
  if(principal.organizationType==="CLIENT"&&principal.clientOrganizationId){where="p.client_organization_id=$1";params.push(principal.clientOrganizationId)}
  else if(principal.organizationType==="AGENCY"){const ids=[...principal.assignedClientOrganizationIds];where=ids.length===0?"FALSE":`p.client_organization_id IN (${ids.map((_,i)=>`$${i+1}`).join(",")})`;params.push(...ids)}
  else if(principal.role!=="PLATFORM_SUPER_ADMIN")where="FALSE";
  const projects=await db.query<any>(`SELECT p.id,p.name,p.client_organization_id,o.display_name AS client_name FROM project p JOIN organization o ON o.id=p.client_organization_id WHERE ${where} ORDER BY o.display_name,p.name,p.id`,params);
  const values:ManualProbeProjectOption[]=[];
  for(const p of projects.rows){const questions=await readConfirmedManualProbeQuestions(db,p.client_organization_id??p.clientOrganizationId??principal.clientOrganizationId??"",p.id);values.push({projectId:p.id,projectName:safeBusinessDisplayName(p.name,"项目"),clientName:safeBusinessDisplayName(p.client_name),questions})}
  return {projects:values,platforms:[{code:"DOUBAO",displayName:"豆包"},{code:"QWEN",displayName:"通义千问"},{code:"DEEPSEEK",displayName:"DeepSeek"},{code:"YUANBAO",displayName:"腾讯元宝"}]};
}

export interface PolicyPackReadModel { readonly projectId:string; readonly industry:{readonly id:string;readonly slug:string;readonly label:string}|null; readonly pack:VerticalPolicyPackDefinition; readonly switching:{readonly allowed:false;readonly reason:string}; readonly recentEvaluations:readonly {readonly category:string;readonly status:"PASSED"|"FAILED";readonly failureReasons:readonly string[];readonly evaluatedAt:string}[] }
export async function readPolicyPack(db:Queryable,projectId:string):Promise<PolicyPackReadModel>{
  const profile=await db.query<any>("SELECT id,vertical_slug,vertical_label FROM industry_profile WHERE project_id=$1 LIMIT 1",[projectId]); const p=profile.rows[0];
  const selection=p?await db.query<any>("SELECT pack_id,pack_version FROM industry_profile_pack_selection WHERE project_id=$1 AND industry_profile_id=$2 AND revoked_at IS NULL ORDER BY selected_at DESC LIMIT 1",[projectId,p.id]):{rows:[]};
  const selected=selection.rows[0]; const registry=createDomesticP0PolicyPackRegistry(); const pack=registry.get(selected?.pack_id??"GENERIC_GEO_V1",Number(selected?.pack_version??1));
  if(!pack)throw new Error("Selected policy pack is not registered.");
  const evaluations=await db.query<any>("SELECT category,status,failure_reasons,evaluated_at FROM vertical_rule_evaluation WHERE project_id=$1 ORDER BY evaluated_at DESC,id DESC LIMIT 50",[projectId]);
  return {projectId,industry:p?{id:p.id,slug:p.vertical_slug,label:p.vertical_label}:null,pack,switching:{allowed:false,reason:"当前阶段由平台根据已确认的项目行业资料绑定规则包。为避免绕过行业门禁，工作台暂不提供自行切换；如行业信息有误，请先联系平台管理员核验。"},recentEvaluations:evaluations.rows.map((r:any)=>({category:r.category,status:r.status,failureReasons:Array.isArray(r.failure_reasons)?r.failure_reasons:[],evaluatedAt:iso(r.evaluated_at)!}))};
}
