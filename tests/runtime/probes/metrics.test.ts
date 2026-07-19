import { describe, expect, it } from "vitest";
import type { RawProbeResult } from "../../../src/runtime/probes/manual-sample.js";
import { calculateManualProbeMetrics } from "../../../src/runtime/probes/metrics.js";

function result(id: string, outcome: "ANSWERED" | "FAILED", answerText: string | null): RawProbeResult {
  return {
    id, clientOrganizationId: "c", projectId: "p", platform: "DOUBAO",
    collectionMode: "MANUAL_SAMPLE", question: `q-${id}`, outcome, answerText,
    screenshotReference: null, failureCode: outcome === "FAILED" ? "ANSWER_NOT_RETURNED" : null,
    failureMessage: null, observedAt: "2026-07-19T00:00:00.000Z",
    recordedAt: "2026-07-19T00:01:00.000Z", recordedByUserId: "collector",
  };
}

describe("manual probe metric contract", () => {
  it("uses only reviewed annotations, keeps failures out of mention denominators, and remains traceable", () => {
    const results = [result("r1", "ANSWERED", "文本提到了品牌，但计算器不得解析文本"), result("r2", "ANSWERED", "x"), result("r3", "FAILED", null)];
    const snapshot = calculateManualProbeMetrics(results, [
      { rawProbeResultId: "r1", brandMentioned: false, recommendationIncluded: false, brandMentionCount: 0, competitorMentionCount: 2, citedDomains: ["Example.COM", "example.com"], reviewedByUserId: "reviewer", reviewedAt: "2026-07-19T01:00:00Z" },
      { rawProbeResultId: "r2", brandMentioned: true, recommendationIncluded: true, brandMentionCount: 1, competitorMentionCount: 1, citedDomains: ["source.cn"], reviewedByUserId: "reviewer", reviewedAt: "2026-07-19T01:01:00Z" },
    ]);
    expect(snapshot.brandExposureRate).toMatchObject({ numerator: 1, denominator: 2, rate: 0.5, evidenceResultIds: ["r2"] });
    expect(snapshot.recommendationInclusionRate.rate).toBe(0.5);
    expect(snapshot.competitorVoiceShare).toMatchObject({ numerator: 3, denominator: 4, rate: 0.75 });
    expect(snapshot.questionCoverageRate).toMatchObject({ numerator: 2, denominator: 3, rate: 2 / 3 });
    expect(snapshot.citationDomainDistribution).toEqual([
      { domain: "example.com", count: 1, evidenceResultIds: ["r1"] },
      { domain: "source.cn", count: 1, evidenceResultIds: ["r2"] },
    ]);
  });

  it("never calculates the frozen automatic managed-source citation rate", () => {
    const snapshot = calculateManualProbeMetrics([], []);
    expect(snapshot.managedSourceCitationRate).toEqual({ status: "NOT_CALCULATED", reason: "AUTOMATIC_SOURCE_CITATION_RATE_FROZEN" });
    expect(snapshot.brandExposureRate.rate).toBeNull();
  });

  it("fails closed when an answered result lacks one reviewed annotation", () => {
    expect(() => calculateManualProbeMetrics([result("r1", "ANSWERED", "x")], [])).toThrow("exactly one manual annotation");
    expect(() => calculateManualProbeMetrics([result("r1", "FAILED", null)], [{ rawProbeResultId: "r1", brandMentioned: false, recommendationIncluded: false, brandMentionCount: 0, competitorMentionCount: 0, citedDomains: [], reviewedByUserId: "u", reviewedAt: "2026-07-19T00:00:00Z" }])).toThrow("ANSWERED");
  });
});
