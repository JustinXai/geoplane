/**
 * China AI answer-surface registry. This is deliberately independent from the
 * content-provider boundary: a probe records externally observed answers and
 * never generates product content.
 */
export const PROBE_PLATFORM_CODES = [
  "DOUBAO",
  "QWEN",
  "DEEPSEEK",
  "YUANBAO",
  "KIMI",
  "WENXIN",
] as const;

export type ProbePlatformCode = (typeof PROBE_PLATFORM_CODES)[number];
export type ProbeCollectionMode = "MANUAL_SAMPLE";
export type ProbePlatformStatus = "ACTIVE" | "RESERVED";

export interface ProbePlatformDefinition {
  readonly code: ProbePlatformCode;
  readonly displayName: string;
  readonly status: ProbePlatformStatus;
  readonly allowedCollectionModes: readonly ["MANUAL_SAMPLE"];
}

const definitions: readonly ProbePlatformDefinition[] = [
  { code: "DOUBAO", displayName: "豆包", status: "ACTIVE", allowedCollectionModes: ["MANUAL_SAMPLE"] },
  { code: "QWEN", displayName: "通义千问", status: "ACTIVE", allowedCollectionModes: ["MANUAL_SAMPLE"] },
  { code: "DEEPSEEK", displayName: "DeepSeek", status: "ACTIVE", allowedCollectionModes: ["MANUAL_SAMPLE"] },
  { code: "YUANBAO", displayName: "腾讯元宝", status: "ACTIVE", allowedCollectionModes: ["MANUAL_SAMPLE"] },
  { code: "KIMI", displayName: "Kimi", status: "RESERVED", allowedCollectionModes: ["MANUAL_SAMPLE"] },
  { code: "WENXIN", displayName: "文心一言", status: "RESERVED", allowedCollectionModes: ["MANUAL_SAMPLE"] },
];

export const CHINA_AI_PROBE_REGISTRY = Object.freeze(definitions);

export function getProbePlatform(code: string): ProbePlatformDefinition | undefined {
  return CHINA_AI_PROBE_REGISTRY.find((entry) => entry.code === code);
}

export function isActiveProbePlatform(code: string): code is ProbePlatformCode {
  return getProbePlatform(code)?.status === "ACTIVE";
}
