import type { PlatformOpsOverviewReadModel } from "../../runtime/read-models/platform-ops-overview.js";
import { type ApiClient, defaultApiClient, type Result } from "../../lib/api-client/index.js";
import { loadPlatformDirectory, type PlatformDirectoryReadModel } from "./platform-read-model.js";

export type { PlatformOpsOverviewReadModel, PlatformOverviewQueueItem } from "../../runtime/read-models/platform-ops-overview.js";

export function loadPlatformOpsOverview(client: ApiClient = defaultApiClient): Promise<Result<PlatformOpsOverviewReadModel>> {
  return client.request<PlatformOpsOverviewReadModel>("/api/ops/overview");
}

export interface PlatformOpsHomeReadModel {
  readonly overview: PlatformOpsOverviewReadModel;
  readonly directory: PlatformDirectoryReadModel;
}

export async function loadPlatformOpsHome(client: ApiClient = defaultApiClient): Promise<Result<PlatformOpsHomeReadModel>> {
  const [overview, directory] = await Promise.all([loadPlatformOpsOverview(client), loadPlatformDirectory(client)]);
  if (!overview.ok) return overview;
  if (!directory.ok) return directory;
  return { ok: true, data: { overview: overview.data, directory: directory.data } };
}
