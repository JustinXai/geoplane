import { defaultApiClient, type ApiClient, type Result } from "../../lib/api-client/http.js";
import type {
  ManualProbeSampleInput,
  RawProbeResult,
} from "../../runtime/probes/manual-sample.js";

export const DOMESTIC_AI_PLATFORMS = [
  { code: "DOUBAO", name: "豆包", enabled: true },
  { code: "QWEN", name: "通义千问", enabled: true },
  { code: "DEEPSEEK", name: "DeepSeek", enabled: true },
  { code: "YUANBAO", name: "腾讯元宝", enabled: true },
] as const;

export const PROBE_FAILURE_LABELS = {
  MANUAL_ACCESS_UNAVAILABLE: "当前无法人工访问",
  ANSWER_NOT_RETURNED: "平台未返回回答",
  CAPTURE_INCOMPLETE: "样本证据不完整",
  OTHER: "其他原因",
} as const;

export interface ProbeReportSummary {
  readonly sampleCount: number;
  readonly answeredCount: number;
  readonly failedCount: number;
  readonly managedSourceCitationRate: "尚未计算";
  readonly reviewStatus: "人工指标复核尚未开放";
}

export interface ProbeResultFilters {
  readonly platform: string;
  readonly outcome: "ALL" | "ANSWERED" | "FAILED";
  readonly question: string;
}

export function filterProbeResults(
  results: readonly RawProbeResult[], filters: ProbeResultFilters,
): readonly RawProbeResult[] {
  const needle = filters.question.trim().toLocaleLowerCase("zh-CN");
  return results.filter((item) =>
    (!filters.platform || item.platform === filters.platform) &&
    (filters.outcome === "ALL" || item.outcome === filters.outcome) &&
    (!needle || item.question.toLocaleLowerCase("zh-CN").includes(needle)),
  );
}

export function summarizeProbeResults(results: readonly RawProbeResult[]): ProbeReportSummary {
  const answeredCount = results.filter((item) => item.outcome === "ANSWERED").length;
  return {
    sampleCount: results.length,
    answeredCount,
    failedCount: results.length - answeredCount,
    managedSourceCitationRate: "尚未计算",
    reviewStatus: "人工指标复核尚未开放",
  };
}

export function listManualProbeSamples(
  projectId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly RawProbeResult[]>> {
  return client.request(`/api/probes/manual-samples?projectId=${encodeURIComponent(projectId)}`);
}

export function recordManualProbeSample(
  input: Omit<ManualProbeSampleInput, "clientOrganizationId">,
  client: ApiClient = defaultApiClient,
): Promise<Result<RawProbeResult>> {
  return client.request("/api/probes/manual-samples", { method: "POST", body: input });
}
