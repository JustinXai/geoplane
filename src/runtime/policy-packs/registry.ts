import type { VerticalPolicyPackDefinition } from "./entities.js";
import type { VerticalPolicyPackPort } from "./ports.js";

export class DuplicatePolicyPackError extends Error {}

/** Local immutable registry. A version can be registered once and never overwritten. */
export class VerticalPolicyPackRegistry implements VerticalPolicyPackPort {
  private readonly versions=new Map<string,VerticalPolicyPackDefinition>();
  register(pack:VerticalPolicyPackDefinition):void{const key=this.key(pack.packId,pack.version);if(this.versions.has(key))throw new DuplicatePolicyPackError(`Policy pack ${key} is already registered.`);this.versions.set(key,Object.freeze({...pack,riskTerms:Object.freeze([...pack.riskTerms]),rules:Object.freeze(pack.rules.map(r=>Object.freeze({...r,evidenceReferences:Object.freeze([...r.evidenceReferences])}))),evidenceReferences:Object.freeze([...pack.evidenceReferences])}));}
  get(packId:string,version:number):VerticalPolicyPackDefinition|null{return this.versions.get(this.key(packId,version))??null;}
  private key(packId:string,version:number){return `${packId}@${version}`;}
}

export const GENERIC_GEO_V1:VerticalPolicyPackDefinition=Object.freeze({packId:"GENERIC_GEO_V1",verticalSlug:"generic",version:1,effectiveFrom:"2026-07-19T00:00:00.000Z",mandatoryHumanReview:false,riskTerms:Object.freeze([]),rules:Object.freeze([]),evidenceReferences:Object.freeze(["docs/recovery/国内GEO系统冻结结构.md"])});

export function createDefaultPolicyPackRegistry():VerticalPolicyPackRegistry{const registry=new VerticalPolicyPackRegistry();registry.register(GENERIC_GEO_V1);return registry;}
