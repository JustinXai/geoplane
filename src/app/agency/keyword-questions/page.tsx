"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — 关键词问题 (keyword ↔ question mappings) read-only
 * preview for the AGENCY workspace, wired to the REAL API.
 *
 * The third per-client read view (alongside deliveries and review-queue). Loads GET /api/projects
 * (scoped server-side to ACTIVE-assigned clients) then GET /api/projects/[id]/keyword-questions
 * per project, so no unauthorized client's data can appear. Read-only preview; no write actions.
 *
 * Note: not yet reachable from the agency nav (src/lib/workspace-nav.ts is owned by another lane).
 * Adding the nav link is a batch-2 IA task; this batch delivers the wired read screen itself.
 */
import { useAsyncData } from "@/components/runtime";
import {
  type AgencyProjectReadGroup,
  AgencyAsyncView,
  isAggregateEmpty,
  listClientKeywordQuestions,
  loadAgencyProjectReads,
} from "@/components/agency-runtime";
import type { KeywordQuestionViewV1 } from "@/runtime/api-contracts";

type KeywordGroups = readonly AgencyProjectReadGroup<KeywordQuestionViewV1>[];

export default function AgencyKeywordQuestionsPage() {
  const { state } = useAsyncData<KeywordGroups>(
    () => loadAgencyProjectReads<KeywordQuestionViewV1>(listClientKeywordQuestions),
    { isEmpty: isAggregateEmpty },
  );

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>关键词问题</h1>
          <span>授权客户项目的关键词与用户问题映射只读预览。</span>
        </div>
      </header>

      <AgencyAsyncView<KeywordGroups>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无关键词问题映射。</p>}
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
                {group.items.map((entry) => (
                  <li className="cp-list-row" key={`${group.project.id}:${entry.keyword}`}>
                    <span className="cp-list-title">{entry.keyword}</span>
                    <span className="cp-list-meta">
                      优先级 {entry.priority} · 用户问题 {entry.userQuestions.length} 个
                    </span>
                    <span className="cp-list-summary">{entry.userQuestions.join(" · ")}</span>
                  </li>
                ))}
                {group.items.length === 0 ? (
                  <li className="cp-list-row cp-list-empty">该项目暂无关键词问题映射。</li>
                ) : null}
              </ul>
            </section>
          ))
        }
      </AgencyAsyncView>
    </>
  );
}
