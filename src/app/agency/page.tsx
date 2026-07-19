"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — AGENCY workspace landing (客户概览 / client
 * overview), wired to the REAL API (GET /api/agency/clients), replacing placeholder text.
 *
 * Assignment isolation: the overview counts are derived solely from GET /api/agency/clients,
 * which returns ONLY the agency's ACTIVE-assigned clients. Read-only summary; no write actions.
 */
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView, getAgencyPortfolio } from "@/components/agency-runtime";
import type { AgencyPortfolioSummary } from "@/runtime/agency-delivery/contracts";

export default function AgencyWorkspaceHomePage() {
  const { state } = useAsyncData<AgencyPortfolioSummary>(() => getAgencyPortfolio());

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>代理商总览</h1>
          <span>仅汇总当前代理商已获授权客户的真实业务进度。</span>
        </div>
      </header>

      <AgencyAsyncView<AgencyPortfolioSummary>
        state={state}
      >
        {(portfolio) => {
          return (
            <section className="cp-section">
              <h2>业务进度</h2>
              <ul className="cp-list">
                <li className="cp-list-row"><span className="cp-list-title">授权客户</span><span className="cp-list-meta">{portfolio.authorizedClientCount} 家</span></li>
                <li className="cp-list-row"><span className="cp-list-title">活跃项目</span><span className="cp-list-meta">{portfolio.activeProjectCount} 个</span></li>
                <li className="cp-list-row"><span className="cp-list-title">资料待补齐</span><span className="cp-list-meta">{portfolio.clientsNeedingKnowledge} 个项目</span></li>
                <li className="cp-list-row"><span className="cp-list-title">关键词待确认</span><span className="cp-list-meta">{portfolio.clientsNeedingKeywordConfirmation} 个项目</span></li>
                <li className="cp-list-row"><span className="cp-list-title">内容待审核</span><span className="cp-list-meta">{portfolio.contentAwaitingReview} 项</span></li>
                <li className="cp-list-row"><span className="cp-list-title">待交付</span><span className="cp-list-meta">{portfolio.projectsAwaitingDelivery} 个项目</span></li>
                <li className="cp-list-row"><span className="cp-list-title">已完成交付</span><span className="cp-list-meta">{portfolio.completedDeliveries} 个项目</span></li>
                <li className="cp-list-row"><span className="cp-list-title">异常账号</span><span className="cp-list-meta">{portfolio.abnormalAccounts} 个</span></li>
              </ul>
            </section>
          );
        }}
      </AgencyAsyncView>
    </>
  );
}
