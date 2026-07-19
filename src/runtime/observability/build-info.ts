export interface BuildInfoV1 {
  readonly branch: string;
  readonly gitSha: string;
  readonly buildTime: string;
  readonly migrationHead: "0017";
  readonly providerRuntime: "OFF" | "INVALID_CONFIGURATION";
}

function safeBuildValue(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && /^[\w./:@+-]+$/.test(trimmed) ? trimmed : "unknown";
}

export function readBuildInfo(
  env: Readonly<Record<string, string | undefined>> = process.env,
): BuildInfoV1 {
  const providerOff = env.PROVIDER_RUNTIME_ENABLED?.trim().toLowerCase() === "false";
  return {
    branch: safeBuildValue(env.GEO_BUILD_BRANCH),
    gitSha: safeBuildValue(env.GEO_BUILD_GIT_SHA),
    buildTime: safeBuildValue(env.GEO_BUILD_TIME),
    migrationHead: "0017",
    providerRuntime: providerOff ? "OFF" : "INVALID_CONFIGURATION",
  };
}
