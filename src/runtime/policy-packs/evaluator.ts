import type { VerticalGateResult, VerticalPolicyPackDefinition, VerticalRuleEvaluation } from "./entities.js";

export interface PolicyEvaluationInput{readonly projectId:string;readonly industryProfileId:string;readonly qualityGateStatus:"PASSED"|"FAILED";readonly platformGateStatus:"PASSED"|"FAILED";readonly deterministicRuleOutcomes?:Readonly<Record<string,boolean>>;readonly manuallyConfirmedRuleIds?:readonly string[];readonly manualReviewerId?:string|null;}

/** Evaluates only after quality and platform gates; it never creates a human approval. */
export function evaluateVerticalPolicyPack(pack:VerticalPolicyPackDefinition,input:PolicyEvaluationInput):VerticalGateResult{
  if(input.qualityGateStatus!=="PASSED")throw new Error("Quality gate must pass before platform and vertical evaluation.");
  if(input.platformGateStatus!=="PASSED")throw new Error("Platform rule gate must pass before vertical evaluation.");
  const confirmations=new Set(input.manuallyConfirmedRuleIds??[]);const reviewer=input.manualReviewerId?.trim()??"";
  const evaluations:VerticalRuleEvaluation[]=pack.rules.map(rule=>{
    const passed=rule.evaluationMode==="DETERMINISTIC"?input.deterministicRuleOutcomes?.[rule.ruleId]===true:reviewer.length>0&&confirmations.has(rule.ruleId);
    return passed?{ruleId:rule.ruleId,category:rule.category,layer:rule.layer,status:"PASSED"}:{ruleId:rule.ruleId,category:rule.category,layer:rule.layer,status:"FAILED",failureReasons:[rule.evaluationMode==="MANUAL_CONFIRMATION"?"Explicit manual confirmation is required for this rule category.":"Deterministic rule evidence did not pass."]};
  });
  const failures=evaluations.flatMap(e=>e.status==="FAILED"?[...(e.failureReasons??[])]:[]);
  return failures.length?{packId:pack.packId,packVersion:pack.version,projectId:input.projectId,industryProfileId:input.industryProfileId,status:"FAILED",failureReasons:failures as [string,...string[]],ruleEvaluations:evaluations,requiresHumanReview:true}:{packId:pack.packId,packVersion:pack.version,projectId:input.projectId,industryProfileId:input.industryProfileId,status:"PASSED",ruleEvaluations:evaluations,requiresHumanReview:pack.mandatoryHumanReview};
}

/** The business chain always proceeds to an explicit human-review gate, never auto approval. */
export function nextGateAfterVertical(result:VerticalGateResult):"BLOCKED"|"HUMAN_REVIEW"{return result.status==="PASSED"?"HUMAN_REVIEW":"BLOCKED";}
