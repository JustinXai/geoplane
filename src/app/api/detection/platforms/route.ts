import { apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { CHINA_AI_PROBE_REGISTRY } from "../../../../runtime/probes/registry.js";
import type { ProbePlatformDefinition } from "../../../../runtime/probes/registry.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const activePlatforms: ProbePlatformDefinition[] = CHINA_AI_PROBE_REGISTRY.filter(
    (p) => p.status === "ACTIVE",
  );
  return toHttpResponse(apiOk(activePlatforms));
}
