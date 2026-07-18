"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — 客户项目 (client projects) for the AGENCY
 * workspace, wired to the REAL API (GET /api/projects), replacing the fixture list.
 *
 * Assignment isolation: GET /api/projects scopes results server-side to the agency's
 * ACTIVE-assigned client organizations, so no unauthorized client's project can appear.
 * Read-only preview — projects are grouped by client for display; no write actions.
 */
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView, listAgencyProjects } from "@/components/agency-runtime";
import type { ProjectViewV1 } from "@/runtime/api-contracts";

interface ClientGroup {
  readonly clientOrganizationId: string;
  readonly clientOrganizationName: string;
  readonly projects: readonly ProjectViewV1[];
}

function groupByClient(projects: readonly ProjectViewV1[]): readonly ClientGroup[] {
  const order: string[] = [];
  const byClient = new Map<string, ProjectViewV1[]>();
  for (const project of projects) {
    const existing = byClient.get(project.clientOrganizationId);
    if (existing === undefined) {
      order.push(project.clientOrganizationId);
      byClient.set(project.clientOrganizationId, [project]);
    } else {
      existing.push(project);
    }
  }
  return order.map((clientOrganizationId) => {
    const groupProjects = byClient.get(clientOrganizationId) ?? [];
    const first = groupProjects[0];
    return {
      clientOrganizationId,
      clientOrganizationName: first?.clientOrganizationName ?? clientOrganizationId,
      projects: groupProjects,
    };
  });
}

export default function AgencyClientProjectsPage() {
  const { state } = useAsyncData<readonly ProjectViewV1[]>(() => listAgencyProjects(), {
    isEmpty: (projects) => projects.length === 0,
  });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>客户项目</h1>
          <span>仅展示当前有效分配中的客户及其项目（只读预览）。</span>
        </div>
      </header>

      <AgencyAsyncView<readonly ProjectViewV1[]>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无授权客户项目。</p>}
      >
        {(projects) =>
          groupByClient(projects).map((group) => (
            <section className="cp-section" key={group.clientOrganizationId}>
              <h2>
                {group.clientOrganizationName}{" "}
                <span className="cp-list-meta">（{group.clientOrganizationId}）</span>
              </h2>
              <ul className="cp-list">
                {group.projects.map((project) => (
                  <li className="cp-list-row" key={project.id}>
                    <span className="cp-list-title">{project.name}</span>
                    <span className="cp-list-meta">
                      项目编号 {project.id} · 创建于 {project.createdAt}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        }
      </AgencyAsyncView>
    </>
  );
}
