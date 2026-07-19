/**
 * CURRENT_REBUILD_ADDITION: minimum category-only pack from the current frozen target.
 * No deleted-system implementation was recovered. No legal text, thresholds or term list is
 * invented: every category requires an explicit named human confirmation.
 */
import type {VerticalPolicyPackDefinition,VerticalRuleDefinition} from "./entities.js";
import {createDefaultPolicyPackRegistry,VerticalPolicyPackRegistry} from "./registry.js";

const EVIDENCE=Object.freeze(["docs/recovery/行业Pack合同与加载机制.md"]);
const manual=(ruleId:string,category:string):VerticalRuleDefinition=>Object.freeze({ruleId,category,layer:"VERTICAL_RULE_GATE",evaluationMode:"MANUAL_CONFIRMATION",evidenceReferences:EVIDENCE});

export const MEDICAL_AESTHETICS_V1:VerticalPolicyPackDefinition=Object.freeze({
  packId:"MEDICAL_AESTHETICS_V1",verticalSlug:"medical-aesthetics",version:1,
  effectiveFrom:"2026-07-19T00:00:00.000Z",mandatoryHumanReview:true,
  // Frozen evidence provides categories only, not an exact risk-term vocabulary.
  riskTerms:Object.freeze([]),
  rules:Object.freeze([
    manual("medical-advertising-boundary","MEDICAL_ADVERTISING_BOUNDARY"),
    manual("absolute-wording","ABSOLUTE_WORDING"),
    manual("efficacy-commitment","EFFICACY_COMMITMENT"),
    manual("practitioner-qualification","PRACTITIONER_QUALIFICATION"),
    manual("institution-qualification","INSTITUTION_QUALIFICATION"),
    manual("product-qualification","PRODUCT_QUALIFICATION"),
    manual("risk-term-review","RISK_TERM_REVIEW"),
    manual("evidence-requirement","EVIDENCE_REQUIREMENT"),
  ]),
  evidenceReferences:EVIDENCE,
});

export function createDomesticP0PolicyPackRegistry():VerticalPolicyPackRegistry{const registry=createDefaultPolicyPackRegistry();registry.register(MEDICAL_AESTHETICS_V1);return registry;}
