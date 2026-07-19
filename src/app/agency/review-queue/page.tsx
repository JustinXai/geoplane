"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — 审核队列 (review queue) for the AGENCY workspace,
 * wired to the REAL API, replacing fixtures.
 *
 * Read-only preview across the agency's authorized projects: loads GET /api/projects (scoped
 * server-side to ACTIVE-assigned clients) then GET /api/projects/[id]/review-queue per project
 * (opportunities that passed validation and await a client review decision). No unauthorized
 * client's items can appear; no approve/reject write actions are wired here.
 */
import { useAsyncData } from "@/components/runtime";
import {
  type AgencyProjectReadGroup,
  AgencyAsyncView,
  isAggregateEmpty,
  listClientReviewQueue,
  loadAgencyProjectReads,
  opportunityStatusLabel,
} from "@/components/agency-runtime";
import type { OpportunityViewV1 } from "@/runtime/api-contracts";

type ReviewGroups = readonly AgencyProjectReadGroup<OpportunityViewV1>[];

export default function AgencyReviewQueuePage() {
  const { state } = useAsyncData<ReviewGroups>(
    () => loadAgencyProjectReads<OpportunityViewV1>(listClientReviewQueue),
    { isEmpty: isAggregateEmpty },
  );

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>审核队列</h1>
          <span>授权客户项目中待客户审核的机会点只读预览；不执行任何通过/驳回操作。</span>
        </div>
      </header>

      <AgencyAsyncView<ReviewGroups>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无待审核项。</p>}
      >
        {(groups) =>
          groups.map((group) => (
            <section className="cp-section" key={group.project.id}>
              <h2>
                {group.project.name}{" "}
                <span className="cp-list-meta">
                  （{group.project.clientOrganizationName}）
                </span>
              </h2>
              <ul className="cp-list">
                {group.items.map((opportunity) => (
                  <li className="cp-list-row" key={opportunity.id}>
                    <span className="cp-list-title">{opportunity.title}</span>
                    <span className="cp-list-meta">
                      状态：{opportunityStatusLabel(opportunity.status)} · 创建于 {new Date(opportunity.createdAt).toLocaleString("zh-CN")}
                    </span>
                    <span className="cp-list-summary">{opportunity.summary}</span>
                  </li>
                ))}
                {group.items.length === 0 ? (
                  <li className="cp-list-row cp-list-empty">该项目暂无待审核项。</li>
                ) : null}
              </ul>
            </section>
          ))
        }
      </AgencyAsyncView>
    </>
  );
}
