/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — pure, React-free read model + logic for the OPS
 * organizations screen. Mirrors the batch-1 agency portfolio logic (client-portfolio.ts): plain
 * functions, unit-testable with no DOM.
 *
 * SINGLE READ MODEL invariant: the KPI tiles and the organizations list must never diverge. Both
 * derive from ONE `OpsOrganizationsReadModel` loaded here. That model holds the org directory AND
 * the project list as two DISTINCT collections, so the "client count" (number of CLIENT
 * organizations) and the "project count" (number of projects) are computed from separate sources
 * and can never be conflated into one another.
 *
 * The loader is fail-closed (like batch-1 project-reads.ts): the first non-ok Result — a
 * non-platform FORBIDDEN, an UNAUTHENTICATED, or any error — is propagated verbatim, so a
 * non-platform principal resolves to the forbidden state and no partial/empty success is faked.
 */
import type { OrganizationType } from "../../contracts/tenancy/entities.js";
import type { ProjectViewV1 } from "../../runtime/api-contracts/index.js";
import { type ApiClient, defaultApiClient, type Result } from "../../lib/api-client/index.js";
import { listAllOrganizations, listOpsProjects, type OrganizationSummaryV1 } from "./ops-api.js";

/** The one read model backing BOTH the KPI tiles and the organizations list. */
export interface OpsOrganizationsReadModel {
  readonly organizations: readonly OrganizationSummaryV1[];
  readonly projects: readonly ProjectViewV1[];
}

/**
 * KPI tiles derived from the single read model. `clientCount` counts CLIENT organizations;
 * `projectCount` counts projects — two DISTINCT numbers from two distinct collections, never the
 * same value conflated.
 */
export interface OpsOrganizationsKpis {
  readonly totalOrganizations: number;
  readonly platformCount: number;
  readonly agencyCount: number;
  readonly clientCount: number;
  readonly projectCount: number;
}

/**
 * Loads the organizations screen's single read model: the org directory (GET /api/ops/
 * organizations) plus the projects list (GET /api/projects). Fail-closed — the org read runs first,
 * so a non-platform caller short-circuits to its FORBIDDEN result without a second request.
 */
export async function loadOpsOrganizations(
  client: ApiClient = defaultApiClient,
): Promise<Result<OpsOrganizationsReadModel>> {
  const orgsResult = await listAllOrganizations(client);
  if (!orgsResult.ok) return orgsResult;

  const projectsResult = await listOpsProjects(client);
  if (!projectsResult.ok) return projectsResult;

  return { ok: true, data: { organizations: orgsResult.data, projects: projectsResult.data } };
}

/** Derives the KPI tiles from the single read model. Client count and project count are distinct. */
export function deriveOrganizationKpis(model: OpsOrganizationsReadModel): OpsOrganizationsKpis {
  const countType = (type: OrganizationType): number =>
    model.organizations.filter((org) => org.type === type).length;

  return {
    totalOrganizations: model.organizations.length,
    platformCount: countType("PLATFORM"),
    agencyCount: countType("AGENCY"),
    clientCount: countType("CLIENT"),
    projectCount: model.projects.length,
  };
}

/** Empty when the org directory has no organizations (drives the Empty state). */
export function isOpsOrganizationsEmpty(model: OpsOrganizationsReadModel): boolean {
  return model.organizations.length === 0;
}

/**
 * The organizations matching an optional case-insensitive search over display name + id + type.
 * Only ever narrows the loaded directory — never reaches outside `model.organizations`.
 */
export function filterOrganizations(
  model: OpsOrganizationsReadModel,
  query = "",
): readonly OrganizationSummaryV1[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return model.organizations;
  return model.organizations.filter(
    (org) =>
      org.displayName.toLowerCase().includes(needle) ||
      org.id.toLowerCase().includes(needle) ||
      org.type.toLowerCase().includes(needle),
  );
}

const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  PLATFORM: "平台",
  AGENCY: "代理商",
  CLIENT: "客户",
};

/** Human-facing label for an organization type. */
export function organizationTypeLabel(type: OrganizationType): string {
  return ORGANIZATION_TYPE_LABELS[type];
}

const ORGANIZATION_STATUS_LABELS: Record<OrganizationSummaryV1["status"], string> = {
  ACTIVE: "已启用",
  SUSPENDED: "已停用",
  ARCHIVED: "已归档",
};

/** Human-facing label for an organization status. */
export function organizationStatusLabel(status: OrganizationSummaryV1["status"]): string {
  return ORGANIZATION_STATUS_LABELS[status];
}
