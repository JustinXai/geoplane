"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — 内容与信源 (content & source grounding), wired to
 * real APIs (replaces the C2 fixtures). Resolves the caller's active project, then loads its
 * knowledge-grounded content opportunities (GET /api/projects/[projectId]/opportunities) —
 * the read-side content items the endpoints currently support. Renders all five async states
 * via the shared AsyncSection.
 *
 * The C5 per-row ClientConfirmationControls (content-direction + source-type, client-side
 * presentation-only three-state decisions) are preserved as scaffolding on each real row.
 */
import { useAsyncData } from "../../../components/runtime/index.js";
import { AsyncSection } from "../../../components/client-runtime/AsyncSection.js";
import { loadActiveProjectOpportunities } from "../../../components/client-runtime/endpoints.js";
import { isEmptyArray, toOpportunityRows } from "../../../components/client-runtime/view-models.js";
import { ClientConfirmationControl } from "../_confirmation-control";

export default function ContentSourcingPage() {
  const { state, reload } = useAsyncData(loadActiveProjectOpportunities, {
    isEmpty: isEmptyArray,
  });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>内容与信源</h1>
          <span>基于知识库的内容方向及其确认状态。</span>
        </div>
      </header>
      <AsyncSection
        state={state}
        onRetry={reload}
        empty={<p className="cp-list-row cp-list-empty">暂无内容方向。</p>}
      >
        {(rows) => (
          <ul className="cp-list">
            {toOpportunityRows(rows).map((row, index) => (
              <li className="cp-list-row" key={`${row.title}-${index}`}>
                <span className="cp-list-title">{row.title}</span>
                <span className="cp-list-meta">状态：{row.statusLabel}</span>
                <span className="cp-list-summary">{row.summary}</span>
                <div className="cp-confirm-group">
                  <ClientConfirmationControl subjectLabel="内容方向" />
                  <ClientConfirmationControl subjectLabel="信源类型" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
    </>
  );
}
