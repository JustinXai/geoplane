/**
 * MVP Detection Analysis — simplified type contracts.
 * Only answers: "Does this AI answer mention the brand?"
 */

export interface DetectionObservation {
  readonly id: string;
  readonly detectionTaskId: string;
  readonly runId: string;
  readonly platform: string;
  readonly question: string;
  readonly answerText: string;
  readonly brandMentioned: boolean;
  readonly matchedBrandTerms: string[];
  readonly brandMentionCount: number;
  readonly completedAt: string;
}
