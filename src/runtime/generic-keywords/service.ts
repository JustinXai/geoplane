import {normalizeKeyword} from "../keywords/normalization.js";
import type {DemandEvidence,GenericKeywordParsedFile,KeywordDataset,KeywordDecision,KeywordImportBatch,KeywordRecord,KeywordScope,KeywordSource} from "./contracts.js";
import type {GenericKeywordRepository,KeywordCoreIdFactory} from "./ports.js";

const evidenceSources=new Set<KeywordSource>(["GENERIC_FILE","BAIDU_KEYWORD","CUSTOMER_HISTORY","OTHER_PROVIDER"]);
export class GenericKeywordService {
  constructor(private readonly repo:GenericKeywordRepository,private readonly ids:KeywordCoreIdFactory,private readonly now:()=>string){}
  async createDataset(input:KeywordScope&{name:string;source:KeywordSource;createdByUserId:string}):Promise<KeywordDataset>{
    if(!input.name.trim())throw new Error("DATASET_NAME_REQUIRED");
    const value={...input,id:this.ids.next(),name:input.name.trim(),status:"ACTIVE" as const,createdAt:this.now()};
    await this.repo.addDataset(value);return value;
  }
  async addManualKeyword(input:KeywordScope&{datasetId:string;keyword:string;category?:string;note?:string;region?:string;periodStart?:string;periodEnd?:string;createdByUserId:string}):Promise<KeywordRecord>{
    const dataset=await this.requireDataset(input,input.datasetId);if(dataset.status!=="ACTIVE")throw new Error("KEYWORD_DATASET_ARCHIVED");if(!input.keyword.trim())throw new Error("KEYWORD_REQUIRED");
    const value:KeywordRecord={...input,id:this.ids.next(),keyword:input.keyword.trim(),normalizedKeyword:normalizeKeyword(input.keyword),source:"MANUAL",createdAt:this.now()};
    await this.repo.addRecords([value]);return value;
  }
  async importFile(input:KeywordScope&{datasetId:string;source:Exclude<KeywordSource,"MANUAL">;fileName:string;parsed:GenericKeywordParsedFile;importedByUserId:string}){
    const dataset=await this.requireDataset(input,input.datasetId);if(dataset.status!=="ACTIVE")throw new Error("KEYWORD_DATASET_ARCHIVED");if(dataset.source!==input.source)throw new Error("DATASET_SOURCE_MISMATCH");
    const at=this.now(),batchId=this.ids.next();
    const records:KeywordRecord[]=input.parsed.rows.map(row=>({id:this.ids.next(),clientOrganizationId:input.clientOrganizationId,projectId:input.projectId,datasetId:input.datasetId,importBatchId:batchId,keyword:row.keyword.trim(),normalizedKeyword:normalizeKeyword(row.keyword),source:input.source,...(row.category?{category:row.category}:{}),...(row.note?{note:row.note}:{}),...(row.region?{region:row.region}:{}),...(row.periodStart?{periodStart:row.periodStart}:{}),...(row.periodEnd?{periodEnd:row.periodEnd}:{}),createdByUserId:input.importedByUserId,createdAt:at}));
    const evidence:DemandEvidence[]=[];
    for(let index=0;index<input.parsed.rows.length;index++){const row=input.parsed.rows[index]!,record=records[index]!;if(row.metricValue===undefined)continue;if(!row.metricKind||!row.sourceReference||!row.observedAt)throw new Error("INCOMPLETE_DEMAND_EVIDENCE");if(!evidenceSources.has(input.source))throw new Error("UNTRUSTED_DEMAND_EVIDENCE_SOURCE");evidence.push({id:this.ids.next(),clientOrganizationId:input.clientOrganizationId,projectId:input.projectId,keywordRecordId:record.id,source:input.source,metricKind:row.metricKind,metricValue:row.metricValue,...(row.metricUnit?{metricUnit:row.metricUnit}:{}),...(row.region?{region:row.region}:{}),...(row.periodStart?{periodStart:row.periodStart}:{}),...(row.periodEnd?{periodEnd:row.periodEnd}:{}),sourceReference:row.sourceReference,observedAt:row.observedAt,recordedAt:at});}
    const batch:KeywordImportBatch={id:batchId,clientOrganizationId:input.clientOrganizationId,projectId:input.projectId,datasetId:input.datasetId,source:input.source,format:input.parsed.format,fileName:input.fileName,manifestHash:input.parsed.sourceHash,status:"COMPLETED",acceptedCount:records.length,rejectedCount:input.parsed.rejected.length,importedByUserId:input.importedByUserId,importedAt:at};
    await this.repo.saveImportedBatch(batch,records,evidence);return{batchId,records,evidence,rejectedCount:input.parsed.rejected.length};
  }
  async createReviewPackage(input:KeywordScope&{datasetId:string;keywordRecordIds:readonly string[];version:number;submittedByUserId:string}){
    const dataset=await this.requireDataset(input,input.datasetId);if(dataset.status!=="ACTIVE")throw new Error("KEYWORD_DATASET_ARCHIVED");if(input.keywordRecordIds.length===0)throw new Error("REVIEW_PACKAGE_REQUIRES_ITEM");const records=await this.repo.listRecords(input,input.datasetId),allowed=new Set(records.map(x=>x.id));if(input.keywordRecordIds.some(x=>!allowed.has(x)))throw new Error("KEYWORD_RECORD_NOT_IN_DATASET");const value={...input,id:this.ids.next(),status:"OPEN" as const,submittedAt:this.now()};await this.repo.addReviewPackage(value);return value;
  }
  async decide(input:KeywordScope&{reviewPackageId:string;keywordRecordId:string;decision:KeywordDecision;reviewerUserId:string;note?:string}){const pkg=await this.repo.getReviewPackage(input,input.reviewPackageId);if(!pkg?.keywordRecordIds.includes(input.keywordRecordId))throw new Error("REVIEW_ITEM_NOT_FOUND");if(input.decision!=="CONFIRMED"&&!input.note?.trim())throw new Error("REVIEW_NOTE_REQUIRED");const value={...input,id:this.ids.next(),decidedAt:this.now()};await this.repo.addDecision(value);return value;}
  async archiveDataset(input:KeywordScope&{datasetId:string}){const dataset=await this.requireDataset(input,input.datasetId);if(dataset.status==="ARCHIVED")return dataset;const changed=await this.repo.archiveDataset(input,input.datasetId);if(!changed)throw new Error("KEYWORD_DATASET_ARCHIVE_CONFLICT");return{...dataset,status:"ARCHIVED" as const};}
  private async requireDataset(scope:KeywordScope,id:string){const value=await this.repo.getDataset(scope,id);if(!value)throw new Error("KEYWORD_DATASET_NOT_FOUND");return value;}
}
