"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — 关键词与用户问题, wired to real APIs (replaces the
 * C2 fixtures). Resolves the caller's active project, then loads its keyword <-> user-question
 * mappings (GET /api/projects/[projectId]/keyword-questions). Renders all five async states
 * via the shared AsyncSection.
 *
 * The C5 per-row ClientConfirmationControl (client-side, presentation-only three-state
 * decision) is preserved as scaffolding on each real row.
 */
import { useAsyncData } from "../../../components/runtime/index.js";
import { AsyncSection } from "../../../components/client-runtime/AsyncSection.js";
import { loadActiveProjectKeywords } from "../../../components/client-runtime/endpoints.js";
import { isEmptyArray, toKeywordRows } from "../../../components/client-runtime/view-models.js";
import { ClientConfirmationControl } from "../_confirmation-control";

export default function KeywordQuestionPage() {
  const { state, reload } = useAsyncData(loadActiveProjectKeywords, { isEmpty: isEmptyArray });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>关键词与用户问题</h1>
          <span>关键词与其对应的用户问题映射，按优先级排列。</span>
        </div>
      </header>
      <AsyncSection
        state={state}
        onRetry={reload}
        empty={<p className="cp-list-row cp-list-empty">暂无关键词与用户问题。</p>}
      >
        {(rows) => (
          <ul className="cp-list">
            {toKeywordRows(rows).map((row) => (
              <li className="cp-list-row" key={row.priority}>
                <span className="cp-list-title">{row.keyword}</span>
                <span className="cp-list-meta">优先级：{row.priority}</span>
                <ul>
                  {row.userQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
                <ClientConfirmationControl subjectLabel="关键词" />
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
    </>
  );
}
