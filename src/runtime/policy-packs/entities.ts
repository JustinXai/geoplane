/**
 * RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/recovery/行业Pack合同与加载机制.md
 * reconstruction_reason: P0 versioned policy-pack contract was missing from the runtime.
 * original_file_unavailable: true
 *
 * Cross-industry core contract. It intentionally contains no vertical-specific fields or terms.
 */
export type PolicyRuleLayer = "PLATFORM_RULE_GATE" | "VERTICAL_RULE_GATE";
export type PolicyRuleEvaluationMode = "DETERMINISTIC" | "MANUAL_CONFIRMATION";
export type PolicyEvaluationStatus = "PASSED" | "FAILED";

export interface VerticalRuleDefinition {
  readonly ruleId: string;
  readonly category: string;
  readonly layer: PolicyRuleLayer;
  readonly evaluationMode: PolicyRuleEvaluationMode;
  readonly evidenceReferences: readonly string[];
}

export interface VerticalPolicyPackDefinition {
  readonly packId: string;
  readonly verticalSlug: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly mandatoryHumanReview: boolean;
  readonly rules: readonly VerticalRuleDefinition[];
  readonly evidenceReferences: readonly string[];
}

export interface IndustryProfilePackSelection {
  readonly projectId: string;
  readonly industryProfileId: string;
  readonly verticalSlug: string;
  readonly packId: string;
  readonly packVersion: number;
}

export interface VerticalRuleEvaluation {
  readonly ruleId: string;
  readonly category: string;
  readonly layer: PolicyRuleLayer;
  readonly status: PolicyEvaluationStatus;
  readonly failureReasons?: readonly [string, ...string[]];
}

export interface VerticalGateResult {
  readonly packId: string;
  readonly packVersion: number;
  readonly projectId: string;
  readonly industryProfileId: string;
  readonly status: PolicyEvaluationStatus;
  readonly failureReasons?: readonly [string, ...string[]];
  readonly ruleEvaluations: readonly VerticalRuleEvaluation[];
  /** A true value requires a later, separate human-review decision; it never means approved. */
  readonly requiresHumanReview: boolean;
}

