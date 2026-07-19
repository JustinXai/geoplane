import type { ProjectViewV1, AuditEventViewV1 } from "../../runtime/api-contracts/index.js";
import { type ApiClient, defaultApiClient, type Result } from "../../lib/api-client/index.js";
import { listAllOrganizations, listOpsAudit, type OrganizationSummaryV1 } from "./ops-api.js";
import { safeBusinessDisplayName } from "../../runtime/ui-adapters/formatters.js";

export interface PlatformDirectoryReadModel {
  readonly organizations: readonly OrganizationSummaryV1[];
  readonly projects: readonly ProjectViewV1[];
  readonly auditEvents: readonly AuditEventViewV1[];
}

export async function loadPlatformDirectory(client: ApiClient = defaultApiClient): Promise<Result<PlatformDirectoryReadModel>> {
  const organizations = await listAllOrganizations(client);
  if (!organizations.ok) return organizations;
  const clients = organizations.data.filter((item) => item.type === "CLIENT");
  const projectResults = await Promise.all(clients.map((item) => client.request<readonly ProjectViewV1[]>(`/api/projects?clientOrganizationId=${encodeURIComponent(item.id)}`)));
  const failed = projectResults.find((item) => !item.ok);
  if (failed && !failed.ok) return failed;
  const audit = await listOpsAudit({ limit: 100 }, client);
  if (!audit.ok) return audit;
  return { ok: true, data: {
    organizations: organizations.data.map((item) => ({ ...item, displayName: safeBusinessDisplayName(item.displayName) })),
    projects: projectResults.flatMap((item) => item.ok ? item.data.map((project) => ({
      ...project,
      name: safeBusinessDisplayName(project.name, "项目"),
      clientOrganizationName: safeBusinessDisplayName(project.clientOrganizationName),
    })) : []),
    auditEvents: audit.data.map((event) => ({
      ...event,
      actorDisplayName: event.actorDisplayName === null ? null : safeBusinessDisplayName(event.actorDisplayName),
    })),
  } };
}

export function organizationCount(model: PlatformDirectoryReadModel, type: "AGENCY"|"CLIENT"): number {
  return model.organizations.filter((item) => item.type === type).length;
}

export function activeProjectCount(model: PlatformDirectoryReadModel): number {
  return model.projects.length;
}

export function recentBusinessProgress(model: PlatformDirectoryReadModel, now = new Date()): readonly AuditEventViewV1[] {
  const boundary = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime();
  return model.auditEvents.filter((event) => {
    const timestamp = Date.parse(event.occurredAt);
    return Number.isFinite(timestamp) && timestamp >= boundary;
  });
}

export function displayDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(timestamp) : "时间待确认";
}
