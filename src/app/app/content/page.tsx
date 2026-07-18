"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — 内容与信源 (content & source grounding), wired to
 * real APIs (replaces the C2 fixtures). Resolves the caller's active project, then loads its
 * knowledge-grounded content opportunities (GET /api/projects/[projectId]/opportunities) —
 * the read-side content items the endpoints currently support. Renders all five async states
 * via the shared AsyncSection.
 *
 * batch 2 wires the per-row 内容方向 confirmation to the real client review command (POST
 * /api/opportunities/[id]/reviews) via OpportunityReviewControl — reviewer server-derived, list
 * refreshes on success. The 信源类型 decision has no modeled command, so it keeps the C5
 * presentation-only ClientConfirmationControl (the intended clean state).
 */
import { useAsyncData } from "../../../components/runtime/index.js";
import { AsyncSection } from "../../../components/client-runtime/AsyncSection.js";
import { loadActiveProjectOpportunities } from "../../../components/client-runtime/endpoints.js";
import { isEmptyArray, toOpportunityRow } from "../../../components/client-runtime/view-models.js";
import { OpportunityReviewControl } from "../../../components/client-runtime/OpportunityReviewControl.js";
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
            {rows.map((opportunity, index) => {
              const row = toOpportunityRow(opportunity);
              return (
                <li className="cp-list-row" key={`${row.title}-${index}`}>
                  <span className="cp-list-title">{row.title}</span>
                  <span className="cp-list-meta">状态：{row.statusLabel}</span>
                  <span className="cp-list-summary">{row.summary}</span>
                  <div className="cp-confirm-group">
                    {/*
                      内容方向 confirmation is the real client review command (POST
                      /api/opportunities/[id]/reviews). The opportunity id is an opaque action
                      handle (never rendered). The validation the command keys on is carried by the
                      client-safe OPAQUE reviewReferenceCode on opportunity.review — never a raw UUID.
                      When review is absent the control renders a disabled affordance (no fabrication).
                      信源类型 has no modeled command and stays presentation-only.
                    */}
                    <OpportunityReviewControl
                      opportunityId={opportunity.id}
                      review={opportunity.review}
                      onReviewed={reload}
                    />
                    <ClientConfirmationControl subjectLabel="信源类型" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AsyncSection>
    </>
  );
}
