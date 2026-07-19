import { describe, expect, it } from "vitest";
import { buildExpansionCombinations } from "../../../src/runtime/keyword-expansion/combination.js";
import { DeterministicOfflineExpansionAdapter } from "../../../src/runtime/keyword-expansion/offline-runtime.js";

describe("six-group keyword and question combination", () => {
  const groups = [
    { type: "PREFIX" as const, values: ["专业"] },
    { type: "MAIN" as const, values: ["牙科"] },
    { type: "SUFFIX" as const, values: ["服务"] },
    { type: "RECOMMENDATION" as const, values: ["推荐"] },
    { type: "QUESTION" as const, values: ["{keyword}哪家好？", "费用是多少？"] },
    { type: "REGION" as const, values: ["上海", "杭州"] },
  ];

  it("combines all six groups in one stable expansion", () => {
    expect(buildExpansionCombinations(groups)).toEqual([
      { keyword: "上海 专业 牙科 服务 推荐", question: "上海 专业 牙科 服务 推荐哪家好？" },
      { keyword: "上海 专业 牙科 服务 推荐", question: "上海 专业 牙科 服务 推荐 费用是多少？" },
      { keyword: "杭州 专业 牙科 服务 推荐", question: "杭州 专业 牙科 服务 推荐哪家好？" },
      { keyword: "杭州 专业 牙科 服务 推荐", question: "杭州 专业 牙科 服务 推荐 费用是多少？" },
    ]);
  });

  it("preserves questions and the human-review boundary in preview", () => {
    const batch = new DeterministicOfflineExpansionAdapter().preview({
      clientOrganizationId: "c", projectId: "p", requestedByUserId: "u",
      reason: "六组人工预览", groups,
    }, "2026-07-19T00:00:00Z");
    expect(batch.candidates).toHaveLength(4);
    expect(batch.candidates.map((candidate) => candidate.question))
      .toEqual(buildExpansionCombinations(groups).map((item) => item.question));
    expect(batch.candidates.every((candidate) => candidate.status === "NEEDS_HUMAN_REVIEW")).toBe(true);
    expect(batch.candidates.every((candidate) => !("searchVolume" in candidate))).toBe(true);
  });
});
