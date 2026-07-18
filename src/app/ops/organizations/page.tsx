"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — 组织 (organizations) for the OPS (platform) workspace,
 * wired to the REAL APIs (GET /api/ops/organizations + GET /api/projects), replacing fixtures.
 *
 * SINGLE READ MODEL: the KPI tiles and the organizations list both derive from ONE
 * OpsOrganizationsReadModel (loadOpsOrganizations), so their numbers can never diverge. The read
 * model carries organizations and projects as two DISTINCT collections — the "客户" (client) tile
 * counts CLIENT organizations while the "项目" (project) tile counts projects, so the two are never
 * conflated.
 *
 * Access: GET /api/ops/organizations is PLATFORM_SUPER_ADMIN-only; a non-platform principal returns
 * FORBIDDEN (or UNAUTHENTICATED), which resolves to the forbidden state below — no organization data
 * is ever rendered for a non-platform caller. Read-only: no write actions are wired.
 */
import { useState } from "react";
import { useAsyncData } from "@/components/runtime";
import {
  OpsAsyncView,
  deriveOrganizationKpis,
  filterOrganizations,
  isOpsOrganizationsEmpty,
  loadOpsOrganizations,
  organizationStatusLabel,
  organizationTypeLabel,
  type OpsOrganizationsReadModel,
} from "@/components/ops-runtime";

export default function OpsOrganizationsPage() {
  const { state } = useAsyncData<OpsOrganizationsReadModel>(() => loadOpsOrganizations(), {
    isEmpty: isOpsOrganizationsEmpty,
  });
  const [query, setQuery] = useState("");

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>组织</h1>
          <span>跨全部组织类型（平台 / 代理商 / 客户）展示，仅平台可见。数据来自真实读取接口。</span>
        </div>
      </header>

      <OpsAsyncView<OpsOrganizationsReadModel>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无任何组织。</p>}
      >
        {(model) => {
          const kpis = deriveOrganizationKpis(model);
          const organizations = filterOrganizations(model, query);
          return (
            <>
              <section className="cp-card-grid" aria-label="组织概览">
                <div className="cp-card">
                  <p className="cp-card-value">{kpis.totalOrganizations}</p>
                  <p className="cp-card-label">组织总数</p>
                </div>
                <div className="cp-card">
                  <p className="cp-card-value">{kpis.agencyCount}</p>
                  <p className="cp-card-label">代理商</p>
                </div>
                <div className="cp-card">
                  <p className="cp-card-value">{kpis.clientCount}</p>
                  <p className="cp-card-label">客户</p>
                </div>
                <div className="cp-card">
                  <p className="cp-card-value">{kpis.projectCount}</p>
                  <p className="cp-card-label">项目</p>
                </div>
              </section>

              <section className="cp-section">
                <label className="cp-field">
                  <span className="cp-field-label">搜索组织</span>
                  <input
                    className="cp-input"
                    type="search"
                    value={query}
                    placeholder="按名称、编号或类型搜索"
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="搜索组织"
                  />
                </label>
              </section>

              <section className="cp-table-wrap">
                <table className="cp-data-table">
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>名称</th>
                      <th>类型</th>
                      <th>状态</th>
                      <th>创建于</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizations.map((org) => (
                      <tr key={org.id}>
                        <td>{org.id}</td>
                        <td>{org.displayName}</td>
                        <td>{organizationTypeLabel(org.type)}</td>
                        <td>{organizationStatusLabel(org.status)}</td>
                        <td>{org.createdAt}</td>
                      </tr>
                    ))}
                    {organizations.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="cp-list-empty">
                          无匹配组织。
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>
            </>
          );
        }}
      </OpsAsyncView>
    </>
  );
}
