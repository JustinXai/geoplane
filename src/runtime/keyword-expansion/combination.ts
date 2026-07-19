import type { ExpansionGroupInput, ExpansionGroupType } from "./contract.js";

export interface ExpansionCombination {
  readonly keyword: string;
  readonly question: string | null;
}

const KEYWORD_ORDER: readonly ExpansionGroupType[] = [
  "REGION", "PREFIX", "MAIN", "SUFFIX", "RECOMMENDATION",
];

function product(groups: readonly ExpansionGroupInput[]): string[][] {
  return groups.reduce<string[][]>(
    (rows, group) => rows.flatMap((row) => group.values.map((value) => [...row, value])),
    [[]],
  );
}

/** QUESTION accepts a literal `{keyword}` placeholder; otherwise it is appended. */
export function buildExpansionCombinations(groups: readonly ExpansionGroupInput[]): ExpansionCombination[] {
  const keywordGroups = KEYWORD_ORDER.map((type) => groups.find((group) => group.type === type))
    .filter((group): group is ExpansionGroupInput => Boolean(group));
  const keywords = product(keywordGroups).map((parts) => parts.join(" ").trim());
  const questions = groups.find((group) => group.type === "QUESTION")?.values ?? [];
  const combinations: ExpansionCombination[] = [];
  for (const keyword of keywords) {
    if (questions.length === 0) {
      combinations.push({ keyword, question: null });
      continue;
    }
    for (const template of questions) {
      combinations.push({
        keyword,
        question: template.includes("{keyword}")
          ? template.replaceAll("{keyword}", keyword).trim()
          : `${keyword} ${template}`.trim(),
      });
    }
  }
  const seen = new Set<string>();
  return combinations.filter((item) => {
    const key = `${item.keyword}\u0000${item.question ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
