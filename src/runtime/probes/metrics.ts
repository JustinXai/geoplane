import type { RawProbeResult } from "./manual-sample.js";

/** Frozen, explainable formula version for manually reviewed probe samples. */
export const MANUAL_PROBE_METRIC_VERSION = "CHINA_AI_MANUAL_METRICS_V1" as const;

export interface ManualProbeAnnotation {
  readonly rawProbeResultId: string;
  /** These facts are supplied by a human reviewer; answer text is never parsed here. */
  readonly brandMentioned: boolean;
  readonly recommendationIncluded: boolean;
  readonly brandMentionCount: number;
  readonly competitorMentionCount: number;
  readonly citedDomains: readonly string[];
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
}

export interface RatioMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number | null;
  readonly evidenceResultIds: readonly string[];
}

export interface ManualProbeMetricSnapshot {
  readonly metricVersion: typeof MANUAL_PROBE_METRIC_VERSION;
  readonly sampleResultIds: readonly string[];
  readonly brandExposureRate: RatioMetric;
  readonly recommendationInclusionRate: RatioMetric;
  readonly managedSourceCitationRate: {
    readonly status: "NOT_CALCULATED";
    readonly reason: "AUTOMATIC_SOURCE_CITATION_RATE_FROZEN";
  };
  readonly competitorVoiceShare: RatioMetric;
  readonly questionCoverageRate: RatioMetric;
  readonly citationDomainDistribution: readonly {
    readonly domain: string;
    readonly count: number;
    readonly evidenceResultIds: readonly string[];
  }[];
}

function ratio(numerator: number, denominator: number, evidenceResultIds: string[]): RatioMetric {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
    evidenceResultIds: [...new Set(evidenceResultIds)].sort(),
  };
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Computes metrics only from explicit human annotations. Failed samples count
 * toward question coverage but never become synthetic "not mentioned" facts.
 */
export function calculateManualProbeMetrics(
  results: readonly RawProbeResult[],
  annotations: readonly ManualProbeAnnotation[],
): ManualProbeMetricSnapshot {
  const ids = new Set<string>();
  for (const result of results) {
    if (ids.has(result.id)) throw new Error(`duplicate raw probe result: ${result.id}`);
    ids.add(result.id);
  }
  const answered = results.filter((result) => result.outcome === "ANSWERED");
  const byResult = new Map(annotations.map((annotation) => [annotation.rawProbeResultId, annotation]));
  if (byResult.size !== annotations.length) throw new Error("duplicate manual annotation");
  for (const annotation of annotations) {
    const result = results.find((candidate) => candidate.id === annotation.rawProbeResultId);
    if (!result || result.outcome !== "ANSWERED") throw new Error("annotation must reference an ANSWERED result");
    if (!annotation.reviewedByUserId.trim() || !Number.isFinite(Date.parse(annotation.reviewedAt))) {
      throw new Error("annotation requires reviewer and timestamp");
    }
    if (!isNonNegativeInteger(annotation.brandMentionCount) || !isNonNegativeInteger(annotation.competitorMentionCount)) {
      throw new Error("mention counts must be non-negative integers");
    }
  }
  if (answered.some((result) => !byResult.has(result.id)) || annotations.length !== answered.length) {
    throw new Error("every ANSWERED result requires exactly one manual annotation");
  }

  const exposureIds = answered.filter((r) => byResult.get(r.id)!.brandMentioned).map((r) => r.id);
  const recommendationIds = answered.filter((r) => byResult.get(r.id)!.recommendationIncluded).map((r) => r.id);
  const answeredIds = answered.map((r) => r.id);
  const brandMentions = annotations.reduce((sum, item) => sum + item.brandMentionCount, 0);
  const competitorMentions = annotations.reduce((sum, item) => sum + item.competitorMentionCount, 0);

  const domainEvidence = new Map<string, Set<string>>();
  for (const annotation of annotations) {
    for (const rawDomain of annotation.citedDomains) {
      const domain = rawDomain.trim().toLowerCase();
      if (!domain) continue;
      const evidence = domainEvidence.get(domain) ?? new Set<string>();
      evidence.add(annotation.rawProbeResultId);
      domainEvidence.set(domain, evidence);
    }
  }

  return {
    metricVersion: MANUAL_PROBE_METRIC_VERSION,
    sampleResultIds: results.map((result) => result.id).sort(),
    brandExposureRate: ratio(exposureIds.length, answered.length, exposureIds),
    recommendationInclusionRate: ratio(recommendationIds.length, answered.length, recommendationIds),
    managedSourceCitationRate: {
      status: "NOT_CALCULATED",
      reason: "AUTOMATIC_SOURCE_CITATION_RATE_FROZEN",
    },
    competitorVoiceShare: ratio(competitorMentions, brandMentions + competitorMentions, answeredIds),
    questionCoverageRate: ratio(answered.length, results.length, answeredIds),
    citationDomainDistribution: [...domainEvidence.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([domain, evidence]) => ({ domain, count: evidence.size, evidenceResultIds: [...evidence].sort() })),
  };
}
