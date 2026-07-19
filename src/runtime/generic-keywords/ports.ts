import type {DemandEvidence,KeywordDataset,KeywordDecisionRecord,KeywordImportBatch,KeywordRecord,KeywordReviewPackage,KeywordScope} from "./contracts.js";

export interface GenericKeywordRepository {
  addDataset(value:KeywordDataset):Promise<void>;
  getDataset(scope:KeywordScope,id:string):Promise<KeywordDataset|undefined>;
  addImportBatch(value:KeywordImportBatch):Promise<void>;
  saveImportedBatch(batch:KeywordImportBatch,records:readonly KeywordRecord[],evidence:readonly DemandEvidence[]):Promise<void>;
  addRecords(values:readonly KeywordRecord[]):Promise<void>;
  addDemandEvidence(values:readonly DemandEvidence[]):Promise<void>;
  listRecords(scope:KeywordScope,datasetId:string):Promise<readonly KeywordRecord[]>;
  addReviewPackage(value:KeywordReviewPackage):Promise<void>;
  getReviewPackage(scope:KeywordScope,id:string):Promise<KeywordReviewPackage|undefined>;
  addDecision(value:KeywordDecisionRecord):Promise<void>;
}

export interface KeywordCoreIdFactory { next():string }
