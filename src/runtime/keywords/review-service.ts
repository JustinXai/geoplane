import type { HumanReviewPackage, KeywordReviewDecision, KeywordReviewRecord, KeywordScope } from "./contracts.js";
import type { KeywordIdFactory } from "./normalization.js";
import type { KeywordRuntimeRepository } from "./ports.js";

export class KeywordReviewService {
  constructor(private readonly repo:KeywordRuntimeRepository,private readonly ids:KeywordIdFactory,private readonly now:()=>string){}
  async createSubmittedFamily(input:KeywordScope&{snapshotId:string;normalizedFormIds:readonly string[];label:string;rationale:string;createdByUserId:string;version:number}):Promise<import("./contracts.js").KeywordFamilyDraft>{
    if(!input.label.trim()||!input.rationale.trim())throw new Error("FAMILY_DETAILS_REQUIRED");
    if(!input.createdByUserId.trim())throw new Error("FAMILY_AUTHOR_REQUIRED");
    if(input.normalizedFormIds.length===0)throw new Error("FAMILY_DRAFT_REQUIRES_MEMBER");
    if(new Set(input.normalizedFormIds).size!==input.normalizedFormIds.length)throw new Error("DUPLICATE_FAMILY_MEMBER");
    const snapshot=await this.repo.getSnapshot(input,input.snapshotId);if(!snapshot)throw new Error("SNAPSHOT_NOT_FOUND");
    const allowed=new Set(await this.repo.listNormalizedFormIdsForSnapshot(input,input.snapshotId));
    if(input.normalizedFormIds.some(id=>!allowed.has(id)))throw new Error("NORMALIZED_FORM_NOT_IN_SNAPSHOT");
    const value={...input,id:this.ids.next(),label:input.label.trim(),rationale:input.rationale.trim(),status:"SUBMITTED" as const,createdAt:this.now()};
    await this.repo.addFamilyDraft(value);return value;
  }
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
