/** Platform-wide, read-only operating summary for the domestic GEO workspace. */
import type { Queryable } from "../../persistence/database-port.js";
import type { AccountCenterReadModel } from "./domestic-workspaces.js";
import { readAccountCenter } from "./domestic-workspaces.js";
import type { GeoPrincipal } from "../geo/runtime-context.js";
import type { DeliveryArticleReadModel } from "../geo/pg/geo-read-repository.js";
import { deriveArticleDeliveryStatus } from "../geo/views.js";
import { safeBusinessDisplayName } from "../ui-adapters/formatters.js";

export interface PlatformOverviewProject {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectName: string;
  readonly clientName: string;
}

export interface PlatformOverviewQueueItem {
  readonly projectId: string;
  readonly projectName: string;
  readonly clientName: string;
  readonly count: number;
}

export interface PlatformOverviewAccountRisk {
  readonly accountId: string;
  readonly displayLabel: string;
  readonly pendingTaskCount: number;
  readonly failedTaskCount: number;
}

export interface PlatformOpsOverviewReadModel {
  readonly totals: {
    readonly agencies: number;
    readonly clients: number;
    readonly activeProjects: number;
    readonly pendingItems: number;
  };
  readonly queues: {
    readonly contentReview: readonly PlatformOverviewQueueItem[];
    readonly delivery: readonly PlatformOverviewQueueItem[];
  };
  readonly risks: {
    readonly abnormalAccounts: readonly PlatformOverviewAccountRisk[];
    readonly failedAccountTasks: number;
  };
  readonly sources: readonly string[];
}

export interface PlatformOpsOverviewFacts {
  readonly agencies: number;
  readonly clients: number;
  readonly projects: readonly PlatformOverviewProject[];
  readonly deliveriesByProject: ReadonlyMap<string, readonly DeliveryArticleReadModel[]>;
  readonly accounts: AccountCenterReadModel;
}

function queueItem(project: PlatformOverviewProject, count: number): PlatformOverviewQueueItem {
  return { projectId: project.id, projectName: project.projectName, clientName: project.clientName, count };
}

/** Pure derivation kept separate so every dashboard number has a testable business definition. */
export function derivePlatformOpsOverview(facts: PlatformOpsOverviewFacts): PlatformOpsOverviewReadModel {
  const contentReview: PlatformOverviewQueueItem[] = [];
  const delivery: PlatformOverviewQueueItem[] = [];

  for (const project of facts.projects) {
    const articles = facts.deliveriesByProject.get(project.id) ?? [];
    const reviewCount = articles.filter((article) => deriveArticleDeliveryStatus(article) === "IN_REVIEW").length;
    const deliveryCount = articles.filter((article) => deriveArticleDeliveryStatus(article) === "APPROVED").length;
    if (reviewCount > 0) contentReview.push(queueItem(project, reviewCount));
    if (deliveryCount > 0) delivery.push(queueItem(project, deliveryCount));

  }

  const abnormalAccounts = facts.accounts.accounts
    .filter((account) => account.riskStatus === "ATTENTION" || account.riskStatus === "BLOCKED" || account.healthStatus === "DEGRADED" || account.healthStatus === "UNAVAILABLE" || account.credentialStatus === "EXPIRED" || account.credentialStatus === "REVOKED")
    .map((account) => ({
      accountId: account.id,
      displayLabel: safeBusinessDisplayName(account.displayLabel, "组织"),
      pendingTaskCount: account.pendingTaskCount,
      failedTaskCount: account.failedTaskCount,
    }));
  const queueTotal = [...contentReview, ...delivery].reduce((sum, item) => sum + item.count, 0);

  return {
    totals: {
      agencies: facts.agencies,
      clients: facts.clients,
      activeProjects: facts.projects.length,
      pendingItems: queueTotal + facts.accounts.totals.pendingTasks,
    },
    queues: { contentReview, delivery },
    risks: {
      abnormalAccounts,
      failedAccountTasks: facts.accounts.totals.failedTasks,
    },
    sources: [
      "组织与项目目录",
      "最新内容版本、人工批准与交付记录",
      "账号健康状态与人工操作任务",
    ],
  };
}

interface ProjectRow {
  id: string;
  client_organization_id: string;
  project_name: string;
  client_name: string;
}

interface CountRow { count: number | string }

export interface PlatformDeliveryReader {
  listDeliveryArticlesByScope(scope: { readonly clientOrganizationId: string; readonly projectId: string }): Promise<readonly DeliveryArticleReadModel[]>;
}

export async function readPlatformOpsOverview(
  db: Queryable,
  principal: GeoPrincipal,
  deliveryReader: PlatformDeliveryReader,
): Promise<PlatformOpsOverviewReadModel> {
  const [agencyResult, clientResult, projectResult, accounts] = await Promise.all([
    db.query<CountRow>("SELECT count(*)::int AS count FROM organization WHERE type='AGENCY'"),
    db.query<CountRow>("SELECT count(*)::int AS count FROM organization WHERE type='CLIENT'"),
    db.query<ProjectRow>(`SELECT p.id,p.client_organization_id,p.name AS project_name,o.display_name AS client_name
      FROM project p JOIN organization o ON o.id=p.client_organization_id
      ORDER BY o.display_name,p.name,p.id`),
    readAccountCenter(db, principal),
  ]);

  const projects = projectResult.rows.map((row): PlatformOverviewProject => ({
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectName: safeBusinessDisplayName(row.project_name, "项目"),
    clientName: safeBusinessDisplayName(row.client_name),
  }));
  const projectFacts = await Promise.all(projects.map(async (project) => {
    const deliveries = await deliveryReader.listDeliveryArticlesByScope({ clientOrganizationId: project.clientOrganizationId, projectId: project.id });
    return { project, deliveries };
  }));

  return derivePlatformOpsOverview({
    agencies: Number(agencyResult.rows[0]?.count ?? 0),
    clients: Number(clientResult.rows[0]?.count ?? 0),
    projects,
    deliveriesByProject: new Map(projectFacts.map((item) => [item.project.id, item.deliveries])),
    accounts,
  });
}
