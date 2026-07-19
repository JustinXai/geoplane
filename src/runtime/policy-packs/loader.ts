import type { IndustryProfilePackSelection, VerticalPolicyPackDefinition } from "./entities.js";
import type { IndustryProfilePackSelectionPort, VerticalPolicyPackPort } from "./ports.js";

export class PolicyPackLoadError extends Error{constructor(message:string){super(message);this.name="PolicyPackLoadError";}}
export interface LoadPolicyPackInput{readonly projectId:string;readonly industryProfileId:string;readonly verticalSlug:string;}

/** Resolves Project -> IndustryProfile -> versioned Pack and fails closed on stale mappings. */
export class VerticalPolicyPackLoader{
  constructor(private readonly registry:VerticalPolicyPackPort,private readonly selections:IndustryProfilePackSelectionPort){}
  async load(input:LoadPolicyPackInput):Promise<VerticalPolicyPackDefinition>{
    const selected=await this.selections.find(input.projectId,input.industryProfileId);
    if(selected&&(selected.projectId!==input.projectId||selected.industryProfileId!==input.industryProfileId||selected.verticalSlug!==input.verticalSlug))throw new PolicyPackLoadError("Policy pack selection does not match the project industry profile.");
    const packId=selected?.packId??"GENERIC_GEO_V1";const version=selected?.packVersion??1;const pack=this.registry.get(packId,version);
    if(!pack)throw new PolicyPackLoadError(`Policy pack ${packId}@${version} is not registered.`);
    if(selected&&pack.verticalSlug!==input.verticalSlug)throw new PolicyPackLoadError("Registered policy pack does not match the selected vertical.");
    return pack;
  }
}

export class InMemoryIndustryProfilePackSelections implements IndustryProfilePackSelectionPort{
  constructor(private readonly values:readonly IndustryProfilePackSelection[]=[]){ }
  async find(projectId:string,industryProfileId:string){return this.values.find(v=>v.projectId===projectId&&v.industryProfileId===industryProfileId)??null;}
}
