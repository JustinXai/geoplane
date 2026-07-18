"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — AGENCY workspace landing (客户概览 / client
 * overview), wired to the REAL API (GET /api/agency/clients), replacing placeholder text.
 *
 * Assignment isolation: the overview counts are derived solely from GET /api/agency/clients,
 * which returns ONLY the agency's ACTIVE-assigned clients. Read-only summary; no write actions.
 */
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView, getAgencyClients, isPortfolioEmpty } from "@/components/agency-runtime";
import type { AgencyClientPortfolioViewV1 } from "@/runtime/api-contracts";

export default function AgencyWorkspaceHomePage() {
  const { state } = useAsyncData<AgencyClientPortfolioViewV1>(() => getAgencyClients(), {
    isEmpty: isPortfolioEmpty,
  });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>客户概览</h1>
          <span>仅统计当前有效分配（ACTIVE）中的客户。</span>
        </div>
      </header>

      <AgencyAsyncView<AgencyClientPortfolioViewV1>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">尚无授权客户。</p>}
      >
        {(portfolio) => {
          const totalProjects = portfolio.clients.reduce((sum, c) => sum + c.projectCount, 0);
          const totalOpenReviews = portfolio.clients.reduce((sum, c) => sum + c.openReviewCount, 0);
          return (
            <section className="cp-section">
              <h2>{portfolio.agencyOrganizationName}</h2>
              <ul className="cp-list">
                <li className="cp-list-row">
                  <span className="cp-list-title">授权客户</span>
                  <span className="cp-list-meta">{portfolio.clients.length} 家</span>
                </li>
                <li className="cp-list-row">
                  <span className="cp-list-title">客户项目</span>
                  <span className="cp-list-meta">{totalProjects} 个</span>
                </li>
                <li className="cp-list-row">
                  <span className="cp-list-title">待审核项</span>
                  <span className="cp-list-meta">{totalOpenReviews} 项</span>
                </li>
              </ul>
            </section>
          );
        }}
      </AgencyAsyncView>
    </>
  );
}
