/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — read-only aggregate loader for the project-scoped
 * agency preview screens (deliveries / review-queue / keyword-questions).
 *
 * The geo read routes are project-scoped, but the agency preview screens keep the existing flat
 * IA. This loader first lists the agency's authorized projects (GET /api/projects, already scoped
 * server-side to ACTIVE-assigned clients) and then reads each project's rows, so no unauthorized
 * client's data is ever fetched. It is fail-closed: the first non-ok Result (FORBIDDEN, error,
 * unauthenticated) is propagated verbatim — failures are never swallowed and never partially
 * hidden behind an empty list.
 */
import type { ProjectViewV1 } from "../../runtime/api-contracts/index.js";
import { type ApiClient, defaultApiClient, type Result } from "../../lib/api-client/index.js";
import { listAgencyProjects } from "./agency-api.js";

/** One authorized project paired with its read rows. */
export interface AgencyProjectReadGroup<T> {
  readonly project: ProjectViewV1;
  readonly items: readonly T[];
}

export type PerProjectReader<T> = (
  projectId: string,
  client: ApiClient,
) => Promise<Result<readonly T[]>>;

/**
 * Loads `reader` for every authorized project and groups the results. Returns:
 *  - the projects' error Result if the project list itself fails, or
 *  - the first failing per-project Result (fail-closed), or
 *  - ok(groups) with one group per project (a project with no rows yields an empty `items`).
 */
export async function loadAgencyProjectReads<T>(
  reader: PerProjectReader<T>,
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly AgencyProjectReadGroup<T>[]>> {
  const projectsResult = await listAgencyProjects(client);
  if (!projectsResult.ok) return projectsResult;

  const groups: AgencyProjectReadGroup<T>[] = [];
  for (const project of projectsResult.data) {
    const rowsResult = await reader(project.id, client);
    if (!rowsResult.ok) return rowsResult;
    groups.push({ project, items: rowsResult.data });
  }
  return { ok: true, data: groups };
}

/** Total rows across all groups. */
export function totalRows<T>(groups: readonly AgencyProjectReadGroup<T>[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

/** Empty predicate for AsyncBoundary: empty when there are no authorized projects OR no rows. */
export function isAggregateEmpty<T>(groups: readonly AgencyProjectReadGroup<T>[]): boolean {
  return totalRows(groups) === 0;
}
