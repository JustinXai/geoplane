import { describe, expect, it } from "vitest";
import { normalizeKeyword, prepareKeywordImport } from "../../../src/runtime/keywords/normalization.js";
import type { KeywordParsedFile } from "../../../src/runtime/keywords/contracts.js";

function ids() {
  let value = 0;
  return { next: () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}` };
}

const parsed: KeywordParsedFile = {
  format: "CSV",
  sourceHash: "a".repeat(64),
  rows: [
    { sourceRow: 2, seedKeyword: "企业增长", keyword: "ＧＥＯ  优化", demandValue: 120 },
    { sourceRow: 3, seedKeyword: "企业增长", keyword: "ＧＥＯ  优化", demandValue: 120 },
    { sourceRow: 4, seedKeyword: "内容运营", keyword: "GEO 优化", demandValue: 120 },
    { sourceRow: 5, seedKeyword: "品牌建设", keyword: "品牌可见度" },
  ],
  rejected: [],
};

describe("keyword normalization and evidence deduplication", () => {
  it("normalizes width/case/space without changing raw evidence", () => {
    expect(normalizeKeyword(" ＧＥＯ\u00a0 优化 ")).toBe("geo 优化");
    const result = prepareKeywordImport({
      clientOrganizationId: "client-a",
      projectId: "project-a",
      sourceFileName: "sanitized.csv",
      parsed,
      now: "2026-07-19T00:00:00.000Z",
      snapshotVersion: 1,
    }, ids());
    expect(result.rawObservations[0]?.rawKeyword).toBe("ＧＥＯ  优化");
    expect(result.normalizedForms[0]?.normalizedKeyword).toBe("geo 优化");
  });

  it("deduplicates identical evidence but preserves one word discovered under multiple seeds", () => {
    const result = prepareKeywordImport({
      clientOrganizationId: "client-a",
      projectId: "project-a",
      sourceFileName: "sanitized.csv",
      parsed,
      now: "2026-07-19T00:00:00.000Z",
      snapshotVersion: 1,
    }, ids());
    expect(result.duplicateRecordCount).toBe(1);
    expect(result.rawObservations).toHaveLength(3);
    const geoForms = result.normalizedForms.filter((form) => form.normalizedKeyword === "geo 优化");
    expect(geoForms).toHaveLength(2);
    expect(result.discoveries.slice(0, 2).map((item) => item.seedKeyword)).toEqual(["企业增长", "内容运营"]);
  });

  it("creates OBSERVED_DEMAND only where imported evidence carries a demand value", () => {
    const result = prepareKeywordImport({
      clientOrganizationId: "client-a",
      projectId: "project-a",
      sourceFileName: "sanitized.csv",
      parsed,
      now: "2026-07-19T00:00:00.000Z",
      snapshotVersion: 1,
    }, ids());
    expect(result.demandObservations).toHaveLength(2);
    expect(result.demandObservations.every((item) => item.status === "OBSERVED_DEMAND")).toBe(true);
    expect(result.snapshot).toMatchObject({ rawObservationCount: 3, normalizedFormCount: 3, demandObservationCount: 2 });
  });
});
