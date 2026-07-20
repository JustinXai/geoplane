/**
 * MVP Detection Analysis — pure deterministic brand-matching engine.
 * Zero external calls, zero I/O. Pure function operating only on its inputs.
 * Only determines: does this AI answer mention the brand?
 */

export interface AnalysisInput {
  readonly answerText: string;
  readonly brandName: string;
  readonly brandAliases?: string[];
  readonly competitorNames?: string[];
}

export interface AnalysisResult {
  readonly brandMentioned: boolean;
  readonly matchedBrandTerms: string[];
  readonly brandMentionCount: number;
}

/**
 * Pure deterministic analysis of a single probe answer.
 * Checks if brandName or any brandAlias appears in the answer text.
 *
 * - brandMentioned: true if any term is found
 * - matchedBrandTerms: list of terms that were found
 * - brandMentionCount: total count of all term occurrences
 *
 * No I/O, no external calls, no randomness — fully deterministic.
 */
export function analyzeAnswer(input: AnalysisInput): AnalysisResult {
  const { answerText, brandName, brandAliases = [] } = input;

  const allTerms = [brandName, ...brandAliases];
  const matched: string[] = [];
  let totalCount = 0;

  for (const term of allTerms) {
    if (!term) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    const matches = answerText.match(regex);
    if (matches && matches.length > 0) {
      matched.push(term);
      totalCount += matches.length;
    }
  }

  return {
    brandMentioned: matched.length > 0,
    matchedBrandTerms: matched,
    brandMentionCount: totalCount,
  };
}
