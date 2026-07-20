/**
 * MVP Detection Analysis — service layer.
 * Produces DetectionObservations for a detection run.
 */
import { randomUUID } from "node:crypto";
import type { DetectionObservation } from "./contracts.js";
import { analyzeAnswer } from "./engine.js";

export interface AnalyzeRunInput {
  readonly runId: string;
  readonly brandName: string;
  readonly brandAliases?: string[];
  readonly competitorNames?: string[];
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly platform: string;
    readonly question: string;
    readonly answerText: string | null;
  }>;
}

export interface AnalysisServiceResult {
  readonly observations: DetectionObservation[];
}

export class DetectionAnalysisService {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly nextId: () => string = randomUUID,
  ) {}

  analyzeRun(input: AnalyzeRunInput): AnalysisServiceResult {
    const { runId, brandName, brandAliases, competitorNames, tasks } = input;
    const ts = this.now().toISOString();

    const observations: DetectionObservation[] = tasks
      .filter((t) => t.answerText !== null)
      .map((task) => {
        const result = analyzeAnswer({
          answerText: task.answerText!,
          brandName,
          brandAliases,
          competitorNames,
        });

        return {
          id: this.nextId(),
          detectionTaskId: task.id,
          runId,
          platform: task.platform,
          question: task.question,
          answerText: task.answerText!,
          brandMentioned: result.brandMentioned,
          matchedBrandTerms: result.matchedBrandTerms,
          brandMentionCount: result.brandMentionCount,
          completedAt: ts,
        } satisfies DetectionObservation;
      });

    return { observations };
  }
}
