import type { HumanReviewPackage, KeywordReviewDecision, KeywordReviewRecord, KeywordScope } from "./contracts.js";
import type { KeywordIdFactory } from "./normalization.js";
import type { KeywordRuntimeRepository } from "./ports.js";

export class KeywordReviewService {
  constructor(private readonly repo:KeywordRuntimeRepository,private readonly ids:KeywordIdFactory,private readonly now:()=>string){}
  async createPackage(input:KeywordScope&{snapshotId:string;familyDraftIds:readonly string[];submittedByUserId:string;packageVersion:number}):Promise<HumanReviewPackage>{
    if(input.familyDraftIds.length===0)throw new Error("REVIEW_PACKAGE_REQUIRES_ITEM");
    if(!input.submittedByUserId.trim())throw new Error("SUBMITTER_REQUIRED");
    if(new Set(input.familyDraftIds).size!==input.familyDraftIds.length)throw new Error("DUPLICATE_REVIEW_ITEM");
    for(const id of input.familyDraftIds){const draft=await this.repo.getFamilyDraft(input,id);if(!draft||draft.snapshotId!==input.snapshotId||draft.status!=="SUBMITTED")throw new Error("FAMILY_DRAFT_NOT_REVIEWABLE");}
    const value:HumanReviewPackage={...input,id:this.ids.next(),status:"OPEN",submittedAt:this.now()}; await this.repo.addReviewPackage(value); return value;
  }
  async decide(input:KeywordScope&{reviewPackageId:string;familyDraftId:string;decision:KeywordReviewDecision;reviewerUserId:string;note?:string}):Promise<KeywordReviewRecord>{
    if(!input.reviewerUserId.trim())throw new Error("HUMAN_REVIEWER_REQUIRED");
    const pkg=await this.repo.getReviewPackage(input,input.reviewPackageId);if(!pkg||!pkg.familyDraftIds.includes(input.familyDraftId))throw new Error("REVIEW_ITEM_NOT_FOUND");
    if(input.decision!=="CONFIRMED"&&!input.note?.trim())throw new Error("REVIEW_NOTE_REQUIRED");
    const prior=await this.repo.listReviewRecords(input,input.reviewPackageId);if(prior.some(x=>x.familyDraftId===input.familyDraftId))throw new Error("REVIEW_ITEM_ALREADY_DECIDED");
    const value:KeywordReviewRecord={...input,id:this.ids.next(),decidedAt:this.now()};await this.repo.addReviewRecord(value);return value;
  }
}
